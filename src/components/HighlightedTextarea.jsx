import { useRef, useEffect, useCallback } from 'react';

// Highlights {variables} and [bracket instructions] in orange behind a
// transparent-text textarea. The caret and selection remain native, so
// typing, paste, undo, and screen readers all behave like a normal textarea.
//
// Technique: a mirror <pre> sits absolutely behind the textarea with the
// SAME typography and padding. We keep its scrollTop/scrollLeft in sync
// with the textarea so the highlight lines up while scrolling.

const HL_REGEX = /(\{[^}]+\}|\[[^\]]+\])/g;
const HL_COLOR = '#f5a33c'; // warm orange, matches the screenshot

function segments(value) {
  if (typeof value !== 'string' || value.length === 0) return [{ type: 'text', value: '' }];
  const out = [];
  let last = 0;
  for (const m of value.matchAll(HL_REGEX)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
    out.push({ type: 'hl', value: m[0] });
    last = start + m[0].length;
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  // Trailing newline sentinel so the mirror renders an extra line-height
  // for an in-progress final empty line (matches textarea behavior).
  if (value.endsWith('\n')) out.push({ type: 'text', value: ' ' });
  return out;
}

export default function HighlightedTextarea({
  value,
  onChange,
  rows = 14,
  className = 'textarea textarea-mono',
  style = {},
  ...rest
}) {
  const taRef = useRef(null);
  const mirrorRef = useRef(null);

  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    mirror.scrollTop = ta.scrollTop;
    mirror.scrollLeft = ta.scrollLeft;
  }, []);

  // Re-sync scroll whenever the value changes (e.g. programmatic set).
  useEffect(() => { syncScroll(); }, [value, syncScroll]);

  // Auto-grow the textarea to fit its content. The mirror is absolutely
  // positioned with inset:0, so it follows.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }, [value]);

  const wrapperStyle = {
    position: 'relative',
    ...style,
  };
  // The mirror and textarea must share identical layout: we achieve that
  // by giving both the same className (typography + padding from .textarea)
  // and letting the mirror inherit its size from the textarea via absolute
  // positioning that matches the textarea's bounds.
  const mirrorStyle = {
    position: 'absolute',
    inset: 0,
    margin: 0,
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    overflow: 'hidden',
    color: 'inherit',
    background: 'transparent',
    border: '1px solid transparent', // matches border thickness so padding aligns
  };
  const textareaStyle = {
    position: 'relative',
    background: 'transparent',
    color: 'transparent',
    caretColor: 'var(--text, #e5e7eb)',
    // keep placeholder visible — textarea handles that natively
  };

  const segs = segments(value || '');

  return (
    <div style={wrapperStyle}>
      <pre ref={mirrorRef} className={className} style={mirrorStyle} aria-hidden="true">
        {segs.map((s, i) =>
          s.type === 'hl'
            ? <span key={i} style={{ color: HL_COLOR }}>{s.value}</span>
            : <span key={i}>{s.value}</span>
        )}
      </pre>
      <textarea
        ref={taRef}
        className={className}
        style={textareaStyle}
        rows={rows}
        value={value}
        onChange={onChange}
        onScroll={syncScroll}
        spellCheck={false}
        {...rest}
      />
    </div>
  );
}
