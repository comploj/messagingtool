import { useState } from 'react';
import {
  getAiProviders,
  getDefaultMessageModel,
  setDefaultMessageModel,
  getApiKeyMap,
} from '../utils/storage';
import { useToast } from './Toast';

// Collapsible accent-tinted card in Settings. Picks the provider + model
// used by all AI message generation (Sequences, Playground, Overview,
// Simulate Chat). SDR workflow layers keep their own per-layer overrides.
export default function DefaultMessageModelEditor() {
  const [open, setOpen] = useState(false);
  const [providers] = useState(() => getAiProviders());
  const [keys] = useState(() => getApiKeyMap());
  const [cfg, setCfg] = useState(() => getDefaultMessageModel());
  const toast = useToast();

  const handleSave = () => {
    if (!cfg.providerId) { toast.error('Pick a provider'); return; }
    if (!cfg.model.trim()) { toast.error('Enter a model name'); return; }
    setDefaultMessageModel({ providerId: cfg.providerId, model: cfg.model.trim() });
    toast.success('Default message model saved');
  };

  const selectedProvider = providers.find((p) => p.id === cfg.providerId);
  const hasKey = !!keys[cfg.providerId];

  return (
    <div
      style={{
        marginBottom: 16,
        border: '1px solid var(--accent)',
        borderRadius: 6,
        background: 'rgba(99, 102, 241, 0.08)',
      }}
    >
      <div
        style={{
          padding: 10,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <strong>Default Message Generation Model</strong>
        <span className="text-secondary text-sm">{open ? '▼' : '▶'}</span>
      </div>
      {open && (
        <div style={{ padding: 12, borderTop: '1px solid var(--accent)' }}>
          <p className="text-secondary text-sm" style={{ marginTop: 0 }}>
            Used for all AI-generated messages in Sequences, Playground, Overview and Simulate Chat. SDR workflow layers keep their own per-layer overrides.
          </p>

          <div className="settings-row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">PROVIDER</label>
              <select
                className="input"
                value={cfg.providerId}
                onChange={(e) => setCfg((c) => ({ ...c, providerId: e.target.value }))}
              >
                {providers.length === 0 && <option value="">No providers configured</option>}
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">MODEL</label>
              <input
                className="input"
                value={cfg.model}
                onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value }))}
                placeholder={selectedProvider?.kind === 'anthropic' ? 'claude-sonnet-4-20250514' : 'anthropic/claude-sonnet-4'}
                spellCheck={false}
              />
            </div>
            <button className="btn btn-primary" onClick={handleSave} style={{ marginBottom: 8 }}>
              Save
            </button>
          </div>

          {selectedProvider && !hasKey && (
            <p className="text-secondary text-sm" style={{ marginTop: 8, marginBottom: 0 }}>
              No API key set for {selectedProvider.name}. Add one above in AI Providers before generating messages.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
