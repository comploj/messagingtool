// Tiny template evaluator that covers the subset of Django/Jinja syntax the
// user's real production workflow relies on:
//   • {% if EXPR %} ... {% elif EXPR %} ... {% else %} ... {% endif %}
//   • {% with EXPR as NAME %} ... {% endwith %}   (pass-through; no scoping)
//   • {{ VAR }} and {Token}                     (substitution, dotted access)
//   • {Token:filter}                             (filter suffix ignored for
//                                                 most tokens; :smart and
//                                                 :include_timestamps are
//                                                 pre-populated as separate
//                                                 context keys by the caller)
//
// EXPR forms supported inside {% if %} / {% elif %}:
//   VAR == "literal"
//   VAR != "literal"
//   VAR == VAR
//   VAR != VAR
//   VAR                 (truthy)
//
// Anything we don't support throws a JinjaLiteError so the caller can surface
// it as a toast. Unknown {{ x.y.z }} lookups render as '' without throwing.

export class JinjaLiteError extends Error {
  constructor(msg) { super(msg); this.name = 'JinjaLiteError'; }
}

// ---------- Value lookup ----------
function lookup(ctx, path) {
  const parts = String(path).trim().split('.');
  let cur = ctx;
  for (const p of parts) {
    if (cur == null) return '';
    cur = cur[p];
  }
  if (cur == null) return '';
  if (typeof cur === 'object') return JSON.stringify(cur);
  return String(cur);
}

function looseLookup(ctx, path) {
  const parts = String(path).trim().split('.');
  let cur = ctx;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ---------- Expression evaluation ----------
function evalExpr(ctx, expr) {
  const s = expr.trim();
  // VAR OP "literal"   OR   VAR OP VAR
  const m = s.match(/^(.+?)\s*(==|!=)\s*(.+?)$/);
  if (m) {
    const [, leftSrc, op, rightSrc] = m;
    const left = resolveOperand(ctx, leftSrc);
    const right = resolveOperand(ctx, rightSrc);
    return op === '==' ? left === right : left !== right;
  }
  // Truthy
  const v = looseLookup(ctx, s);
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '' && v !== 'False';
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}

function resolveOperand(ctx, src) {
  const s = src.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return s; // numeric literal as string — comparisons are lexical
  const v = looseLookup(ctx, s);
  if (v === undefined || v === null) return '';
  return String(v);
}

// ---------- Tokeniser ----------
function tokenise(tpl) {
  const tokens = [];
  const re = /({%[\s\S]*?%}|\{\{[\s\S]*?\}\}|\{[A-Za-z0-9_.:\-]+\})/g;
  let last = 0;
  let m;
  while ((m = re.exec(tpl)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: tpl.slice(last, m.index) });
    const raw = m[0];
    if (raw.startsWith('{%')) {
      tokens.push(parseTag(raw));
    } else if (raw.startsWith('{{')) {
      tokens.push({ type: 'var', name: raw.slice(2, -2).trim() });
    } else {
      const inner = raw.slice(1, -1);
      const [name] = inner.split(':');
      tokens.push({ type: 'token', full: inner, name: name.trim() });
    }
    last = m.index + raw.length;
  }
  if (last < tpl.length) tokens.push({ type: 'text', value: tpl.slice(last) });
  return tokens;
}

function parseTag(raw) {
  const body = raw.slice(2, -2).trim();
  const words = body.split(/\s+/);
  const head = words[0];
  if (head === 'if') return { type: 'if', expr: body.slice(2).trim() };
  if (head === 'elif') return { type: 'elif', expr: body.slice(4).trim() };
  if (head === 'else') return { type: 'else' };
  if (head === 'endif') return { type: 'endif' };
  if (head === 'with') {
    // "{% with EXPR as NAME %}" — we accept any {% with ... %} as a no-op
    return { type: 'with' };
  }
  if (head === 'endwith') return { type: 'endwith' };
  if (head === 'for' || head === 'endfor' || head === 'block' || head === 'endblock' ||
      head === 'include' || head === 'extends' || head === 'macro' || head === 'endmacro') {
    throw new JinjaLiteError(`Unsupported Jinja tag: {% ${head} %} — the playground evaluator only supports if/elif/else/endif and with/endwith.`);
  }
  // Unknown but harmless tag: keep as literal text so the user can see it.
  return { type: 'text', value: raw };
}

// ---------- AST builder (for {% if %} nesting) ----------
// We fold the flat token list into an AST where {% if %}...{% endif %} becomes
// a tree. {% with %}...{% endwith %} is emitted inline as text wrappers.
function buildAst(tokens) {
  let i = 0;
  function parseBlock(stopAt) {
    const out = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (stopAt && stopAt.includes(t.type)) return out;
      if (t.type === 'if') {
        const node = { type: 'if', branches: [] };
        let expr = t.expr;
        i++;
        let body = parseBlock(['elif', 'else', 'endif']);
        node.branches.push({ expr, body });
        while (i < tokens.length && tokens[i].type === 'elif') {
          expr = tokens[i].expr;
          i++;
          body = parseBlock(['elif', 'else', 'endif']);
          node.branches.push({ expr, body });
        }
        if (i < tokens.length && tokens[i].type === 'else') {
          i++;
          const elseBody = parseBlock(['endif']);
          node.branches.push({ expr: null, body: elseBody });
        }
        if (i >= tokens.length || tokens[i].type !== 'endif') {
          throw new JinjaLiteError('Missing {% endif %}');
        }
        i++;
        out.push(node);
        continue;
      }
      if (t.type === 'with' || t.type === 'endwith') {
        // Pass-through: skip the tag, content between with/endwith stays inline.
        i++;
        continue;
      }
      if (t.type === 'elif' || t.type === 'else' || t.type === 'endif') {
        throw new JinjaLiteError(`Stray {% ${t.type} %} without a matching {% if %}.`);
      }
      out.push(t);
      i++;
    }
    if (stopAt) throw new JinjaLiteError(`Unterminated block; expected {% ${stopAt.join('/')} %}.`);
    return out;
  }
  return parseBlock(null);
}

// ---------- Emitter ----------
function emit(nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.value;
    else if (n.type === 'var') out += lookup(ctx, n.name);
    else if (n.type === 'token') {
      // First try the full "{Name:filter}" key (we pre-populate
      // {Conversation:include_timestamps} and {Timeslots:smart} in ctx),
      // then fall back to the bare name.
      const full = n.full;
      const name = n.name;
      if (ctx[full] !== undefined) out += lookup(ctx, full);
      else out += lookup(ctx, name);
    }
    else if (n.type === 'if') {
      let matched = false;
      for (const b of n.branches) {
        if (b.expr === null || evalExpr(ctx, b.expr)) {
          out += emit(b.body, ctx);
          matched = true;
          break;
        }
      }
      if (!matched) {
        // all branches false, no else — emit nothing
      }
    }
  }
  return out;
}

export function render(template, ctx) {
  if (template == null) return '';
  const tokens = tokenise(String(template));
  const ast = buildAst(tokens);
  return emit(ast, ctx || {});
}
