import { useState } from 'react';
import { highlightVars } from '../utils/ai';

export default function MessageRow({ message, output, loading, onGenerate }) {
  const [open, setOpen] = useState(false);

  const segments = highlightVars(message.prompt);

  return (
    <div className="msg-row">
      <div className="msg-row-header" onClick={() => setOpen(!open)}>
        <span className="msg-row-label">{message.label}</span>
        <span className={`badge ${message.type === 'ai' ? 'badge-ai' : 'badge-static'}`}>
          {message.type}
        </span>
        <span className="badge badge-delay">Day {message.delayDays}</span>
        <span className={`msg-row-chevron ${open ? 'open' : ''}`}>&#9654;</span>
      </div>

      {open && (
        <div className="msg-row-body">
          <div className="msg-row-col">
            <div className="msg-row-col-label">Prompt</div>
            <div className="msg-row-prompt">
              {segments.map((seg, i) =>
                seg.type === 'var' ? (
                  <span
                    key={i}
                    className={`var-chip ${seg.isOp ? 'var-chip-op' : 'var-chip-regular'}`}
                  >
                    {seg.value}
                  </span>
                ) : (
                  <span key={i}>{seg.value}</span>
                )
              )}
            </div>
          </div>
          <div className="msg-row-col">
            <div className="msg-row-col-label">Output</div>
            <div className="msg-row-output">
              {loading ? (
                <span className="spinner"></span>
              ) : output ? (
                output
              ) : (
                <span className="text-secondary">Click generate to see output</span>
              )}
            </div>
            {!loading && (
              <button
                className="btn btn-secondary btn-sm msg-row-generate"
                onClick={onGenerate}
              >
                Generate
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
