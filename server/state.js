import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCESS_TOKENS } from './config.js';

const STORE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'store.json');

const DEFAULT_SDR_WORKFLOW_PROMPT = `You are an AI SDR messaging on LinkedIn on behalf of {MyNameFirst} {MyNameLast}.

## What we offer
{ValueProposition}

## The prospect
- Name: {PersonaFirstName} {PersonaLastName}
- Role: {PersonaPosition} at {PersonaCompany}
- Company: {PersonaCompanyDescription}
- Industry: {PersonaIndustry}
- Location: {PersonaLocation}

## Conversation so far
{Transcript}

## Your reply
Write ONE reply, in a warm consultative tone. Acknowledge what {PersonaFirstName} said. Ask one concrete question that moves the conversation forward. Never pitch. Never promise outcomes. 120 words max. Write in {Language}. Output the reply text only — no preamble, no sign-off line repeating your name.`;

const DEFAULT_AI_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages' },
  { id: 'openai', name: 'OpenAI', kind: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1/chat/completions' },
  { id: 'nebius', name: 'Nebius', kind: 'openai_compatible',
    baseUrl: 'https://api.studio.nebius.ai/v1/chat/completions' },
  { id: 'z-ai', name: 'Z.AI (GLM)', kind: 'openai_compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions' },
];

function defaultSdrWorkflows() {
  return [{
    id: 'default-sdr',
    name: 'Default SDR',
    description: 'Warm, consultative, short. Asks a question, never pitches.',
    layers: [{
      id: 'default-sdr-layer-1',
      name: 'Respond',
      description: 'Generates a single reply in a warm consultative tone.',
      providerId: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemMessage: 'You are a helpful assistant that writes one concise, warm LinkedIn reply.',
      temperature: 0.6,
      content: DEFAULT_SDR_WORKFLOW_PROMPT,
    }],
    createdAt: new Date().toISOString(),
  }];
}

// Rewrap any legacy single-prompt workflow into the layered shape. Idempotent.
function migrateSdrWorkflows(workflows) {
  if (!Array.isArray(workflows)) return defaultSdrWorkflows();
  return workflows.map((w) => {
    if (Array.isArray(w.layers) && w.layers.length > 0) return w;
    if (typeof w.prompt === 'string') {
      const { prompt, ...rest } = w;
      return {
        ...rest,
        layers: [{
          id: `${w.id || randomId()}-layer-1`,
          name: 'Respond',
          description: '',
          providerId: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          systemMessage: '',
          temperature: 0.6,
          content: prompt,
        }],
      };
    }
    // No prompt, no layers — drop in an empty default layer so the editor
    // doesn't show an unusable card.
    return {
      ...w,
      layers: [{
        id: `${w.id || randomId()}-layer-1`,
        name: 'Respond',
        description: '',
        providerId: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        systemMessage: '',
        temperature: 0.6,
        content: '',
      }],
    };
  });
}

function emptyStore() {
  return {
    version: 0,
    projects: [],
    customers: [],
    promptOverrides: { strategies: {}, staticFollowups: {} },
    customTokens: [],
    aiProviders: DEFAULT_AI_PROVIDERS.slice(),
    sdrWorkflows: defaultSdrWorkflows(),
    // Map of providerId -> API key. Shared across the team because anyone
    // with a valid login token already has full read access to /api/state.
    // Never surfaced via the public /share/:token endpoint.
    apiKeys: {},
  };
}

function randomId() {
  try { return globalThis.crypto?.randomUUID?.() || ''; } catch {}
  return `cust-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// One-shot migration: synthesize customers from legacy project.clientName
// whenever a project is missing its customerId, and back-fill the FK on every
// such project. Runs on every read but is a no-op after the first write.
function migrateStore(store) {
  const projects = Array.isArray(store.projects) ? store.projects : [];
  let customers = Array.isArray(store.customers) ? store.customers : [];
  const allMigrated = customers.length > 0 && projects.every((p) => p.customerId);
  if (allMigrated) return { ...store, projects, customers };

  const byName = new Map();
  for (const c of customers) byName.set((c.name || '').trim() || 'Uncategorized', c);

  for (const p of projects) {
    const name = (p.clientName || '').trim() || 'Uncategorized';
    if (!byName.has(name)) {
      byName.set(name, {
        id: randomId() || `cust-${byName.size}-${Date.now()}`,
        name,
        website: '',
        createdAt: new Date().toISOString(),
      });
    }
    const cust = byName.get(name);
    if (!cust.website && p.clientWebsite) cust.website = p.clientWebsite;
  }

  customers = Array.from(byName.values());
  const nameToId = Object.fromEntries(customers.map((c) => [c.name, c.id]));

  const nextProjects = projects.map((p) => {
    if (p.customerId) return p;
    const name = (p.clientName || '').trim() || 'Uncategorized';
    return { ...p, customerId: nameToId[name] };
  });
  return { ...store, projects: nextProjects, customers };
}

export async function readStore() {
  let parsed;
  try {
    const raw = await readFile(STORE_FILE, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    return emptyStore();
  }
  const rawWorkflows = Array.isArray(parsed.sdrWorkflows) && parsed.sdrWorkflows.length > 0
    ? parsed.sdrWorkflows
    : defaultSdrWorkflows();
  const sdrWorkflows = migrateSdrWorkflows(rawWorkflows);
  // Merge any missing default providers so new builtins show up automatically.
  const incomingProviders = Array.isArray(parsed.aiProviders) ? parsed.aiProviders : [];
  const providerById = new Map(incomingProviders.map((p) => [p.id, p]));
  for (const def of DEFAULT_AI_PROVIDERS) {
    if (!providerById.has(def.id)) providerById.set(def.id, def);
  }
  const aiProviders = Array.from(providerById.values());
  const base = {
    version: Number(parsed.version) || 0,
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    customers: Array.isArray(parsed.customers) ? parsed.customers : [],
    promptOverrides: parsed.promptOverrides || { strategies: {}, staticFollowups: {} },
    customTokens: Array.isArray(parsed.customTokens) ? parsed.customTokens : [],
    aiProviders,
    sdrWorkflows,
    apiKeys: (parsed.apiKeys && typeof parsed.apiKeys === 'object' && !Array.isArray(parsed.apiKeys))
      ? parsed.apiKeys
      : {},
  };
  return migrateStore(base);
}

export async function writeStore(next) {
  await mkdir(dirname(STORE_FILE), { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(next, null, 2));
}

function tokenOf(req) {
  const h = req.headers?.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  return m ? m[1].trim() : null;
}

async function isValidToken(token) {
  if (!token) return false;
  if (ACCESS_TOKENS.includes(token)) return true;
  const store = await readStore();
  return (store.customTokens || []).includes(token);
}

// Express middleware
export async function requireAuth(req, res, next) {
  if (await isValidToken(tokenOf(req))) return next();
  res.status(401).json({ error: 'invalid_token' });
}

export async function handleAuth(_req, res) {
  res.json({ ok: true });
}

export async function handleGetState(_req, res) {
  res.json(await readStore());
}

export async function handlePutState(req, res) {
  const { baseVersion, state } = req.body || {};
  const current = await readStore();
  if (typeof baseVersion !== 'number' || baseVersion !== current.version) {
    return res.status(409).json({ error: 'version_conflict', current });
  }
  const next = {
    version: current.version + 1,
    projects: Array.isArray(state?.projects) ? state.projects : current.projects,
    customers: Array.isArray(state?.customers) ? state.customers : current.customers,
    promptOverrides: state?.promptOverrides ?? current.promptOverrides,
    customTokens: Array.isArray(state?.customTokens) ? state.customTokens : current.customTokens,
    aiProviders: Array.isArray(state?.aiProviders) ? state.aiProviders : current.aiProviders,
    sdrWorkflows: Array.isArray(state?.sdrWorkflows) ? state.sdrWorkflows : current.sdrWorkflows,
    apiKeys: (state?.apiKeys && typeof state.apiKeys === 'object' && !Array.isArray(state.apiKeys))
      ? state.apiKeys
      : current.apiKeys,
  };
  await writeStore(next);
  res.json({ ok: true, version: next.version });
}

// Public read-only share — no auth. Looks up a project by its shareToken
// and returns a minimal view-only projection with sequences + generated
// outputs + lead info. Viewers can see what the author generated but cannot
// see prompt templates, API keys, or any other project.
export async function handleGetShare(req, res) {
  const token = String(req.params?.token || '').trim();
  if (!token) return res.status(404).json({ error: 'not_found' });
  const store = await readStore();
  const project = (store.projects || []).find((p) => p.shareToken === token);
  if (!project) return res.status(404).json({ error: 'not_found' });
  const customer = (store.customers || []).find((c) => c.id === project.customerId);
  const snapshot = {
    projectName: project.name || '',
    customerName: customer?.name || project.clientName || '',
    language: project.language || 'en',
    sequences: (project.sequences || []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      messages: (s.messages || []).map((m) => ({
        id: m.id,
        label: m.label,
        type: m.type,
        delayDays: m.delayDays,
        prompt: m.prompt || '',
      })),
    })),
    outputs: project.outputs || {},
    lead: project.lead ? {
      firstName: project.lead.firstName || '',
      lastName: project.lead.lastName || '',
      position: project.lead.position || '',
      company: project.lead.company || '',
      companyWebsite: project.lead.companyWebsite || '',
    } : null,
  };
  res.json(snapshot);
}

// Editable share endpoints — a share token grants full edit access to ONE
// specific project (except deleting existing sequences). Used by
// ShareProjectView to let recipients collaborate without logging in.

function stateForShare(store, project) {
  const customer = (store.customers || []).find((c) => c.id === project.customerId);
  return {
    project,
    customer: customer || null,
    promptOverrides: store.promptOverrides || { strategies: {}, staticFollowups: {} },
    version: store.version,
  };
}

export async function handleGetShareState(req, res) {
  const token = String(req.params?.token || '').trim();
  if (!token) return res.status(404).json({ error: 'not_found' });
  const store = await readStore();
  const project = (store.projects || []).find((p) => p.shareToken === token);
  if (!project) return res.status(404).json({ error: 'not_found' });
  res.json(stateForShare(store, project));
}

// Accepts { project, baseVersion }. Validates:
// - Token maps to a project
// - Incoming project.id matches stored project.id
// - Incoming project.shareToken unchanged (viewers cannot rotate/revoke)
// Sequence deletion IS allowed — share-link recipients can remove sequences.
export async function handlePutShareState(req, res) {
  const token = String(req.params?.token || '').trim();
  if (!token) return res.status(404).json({ error: 'not_found' });
  const { project: incoming, baseVersion } = req.body || {};
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'bad_project' });
  }
  const store = await readStore();
  if (typeof baseVersion !== 'number' || baseVersion !== store.version) {
    return res.status(409).json({ error: 'version_conflict', current: stateForShare(store, (store.projects || []).find((p) => p.shareToken === token) || {}) });
  }
  const idx = (store.projects || []).findIndex((p) => p.shareToken === token);
  if (idx < 0) return res.status(404).json({ error: 'not_found' });
  const existing = store.projects[idx];
  if (incoming.id !== existing.id) return res.status(400).json({ error: 'id_mismatch' });

  // Preserve share token and customerId — viewers can't rotate them.
  const sanitized = {
    ...incoming,
    id: existing.id,
    customerId: existing.customerId,
    shareToken: existing.shareToken,
  };
  const nextProjects = [...store.projects];
  nextProjects[idx] = sanitized;
  const next = {
    ...store,
    version: store.version + 1,
    projects: nextProjects,
  };
  await writeStore(next);
  res.json({ ok: true, version: next.version });
}

// Framework-agnostic helpers used by the Vite dev middleware, which doesn't
// pass an Express req/res pair.
export async function processAuth(token) {
  return isValidToken(token);
}

export async function processGetShareState(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const store = await readStore();
  const project = (store.projects || []).find((p) => p.shareToken === t);
  if (!project) return null;
  return stateForShare(store, project);
}

export async function processPutShareState(token, body) {
  const t = String(token || '').trim();
  if (!t) return { error: 'not_found', status: 404 };
  const { project: incoming, baseVersion } = body || {};
  if (!incoming || typeof incoming !== 'object') return { error: 'bad_project', status: 400 };
  const store = await readStore();
  if (typeof baseVersion !== 'number' || baseVersion !== store.version) {
    const p = (store.projects || []).find((pp) => pp.shareToken === t);
    return { error: 'version_conflict', status: 409, current: p ? stateForShare(store, p) : null };
  }
  const idx = (store.projects || []).findIndex((p) => p.shareToken === t);
  if (idx < 0) return { error: 'not_found', status: 404 };
  const existing = store.projects[idx];
  if (incoming.id !== existing.id) return { error: 'id_mismatch', status: 400 };
  // Sequence deletion IS allowed — viewers can remove sequences.
  const sanitized = {
    ...incoming,
    id: existing.id,
    customerId: existing.customerId,
    shareToken: existing.shareToken,
  };
  const nextProjects = [...store.projects];
  nextProjects[idx] = sanitized;
  const next = { ...store, version: store.version + 1, projects: nextProjects };
  await writeStore(next);
  return { ok: true, version: next.version };
}

// Forward an AI request from a share viewer through the OWNER'S Anthropic
// key (kept on the server, never sent to the share-link recipient).
// Body shape mirrors what the client passes to api.anthropic.com/v1/messages:
//   { model?, max_tokens?, messages: [...], tools?: [...] }
// Returns { status, body } where body is either Anthropic's response (on 200)
// or an { error: ... } object.
export async function processShareAi(token, body) {
  const t = String(token || '').trim();
  if (!t) return { status: 404, body: { error: 'not_found' } };
  const store = await readStore();
  const project = (store.projects || []).find((p) => p.shareToken === t);
  if (!project) return { status: 404, body: { error: 'not_found' } };
  const apiKey = store.apiKeys?.anthropic;
  if (!apiKey) return { status: 503, body: { error: 'owner_no_key' } };
  if (!body || typeof body !== 'object') return { status: 400, body: { error: 'bad_body' } };
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { status: 400, body: { error: 'bad_messages' } };
  }
  const payload = {
    model: body.model || 'claude-sonnet-4-20250514',
    max_tokens: Number(body.max_tokens) || 1024,
    messages: body.messages,
  };
  if (Array.isArray(body.tools) && body.tools.length > 0) payload.tools = body.tools;
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    if (!upstream.ok) {
      return { status: upstream.status, body: { error: 'upstream_error', detail: parsed } };
    }
    return { status: 200, body: parsed };
  } catch (err) {
    return { status: 502, body: { error: 'upstream_unreachable', detail: String(err?.message || err) } };
  }
}

export async function handleShareAi(req, res) {
  const token = String(req.params?.token || '').trim();
  const result = await processShareAi(token, req.body);
  res.status(result.status).json(result.body);
}

// For Vite dev middleware to handle /api/share/:token without Express req/res
export async function processShare(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const store = await readStore();
  const project = (store.projects || []).find((p) => p.shareToken === t);
  if (!project) return null;
  const customer = (store.customers || []).find((c) => c.id === project.customerId);
  return {
    projectName: project.name || '',
    customerName: customer?.name || project.clientName || '',
    language: project.language || 'en',
    sequences: (project.sequences || []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      messages: (s.messages || []).map((m) => ({
        id: m.id,
        label: m.label,
        type: m.type,
        delayDays: m.delayDays,
        prompt: m.prompt || '',
      })),
    })),
    outputs: project.outputs || {},
    lead: project.lead ? {
      firstName: project.lead.firstName || '',
      lastName: project.lead.lastName || '',
      position: project.lead.position || '',
      company: project.lead.company || '',
      companyWebsite: project.lead.companyWebsite || '',
    } : null,
  };
}
