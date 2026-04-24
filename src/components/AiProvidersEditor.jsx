import { useState } from 'react';
import {
  getAiProviders, saveAiProvider, deleteAiProvider,
  getApiKey, setApiKey, getApiKeyMap,
} from '../utils/storage';
import { useToast } from './Toast';

const BUILTIN_IDS = new Set(['anthropic', 'openai', 'nebius', 'z-ai']);

// Collapsible accent-tinted card in Settings. Lists all providers, lets the
// user edit base URLs and enter per-user API keys (stored locally, never
// synced). Builtins cannot be deleted — custom entries can.
export default function AiProvidersEditor() {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState(() => getAiProviders());
  const [keys, setKeys] = useState(() => getApiKeyMap());
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const toast = useToast();

  const refresh = () => {
    setProviders(getAiProviders());
    setKeys(getApiKeyMap());
  };

  const updateField = (id, patch) => {
    const existing = getAiProviders().find((p) => p.id === id);
    if (!existing) return;
    saveAiProvider({ ...existing, ...patch });
    refresh();
  };

  const updateKey = (providerId, value) => {
    setApiKey(providerId, value);
    refresh();
  };

  const handleDelete = (p) => {
    if (BUILTIN_IDS.has(p.id)) return;
    if (!window.confirm(`Delete provider "${p.name}"?`)) return;
    deleteAiProvider(p.id);
    refresh();
    toast.success('Provider deleted');
  };

  const handleCreate = (e) => {
    e.preventDefault();
    const id = newId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const name = newName.trim();
    const url = newUrl.trim();
    if (!id || !name || !url) return;
    if (getAiProviders().some((p) => p.id === id)) {
      toast.error('A provider with that ID already exists');
      return;
    }
    saveAiProvider({ id, name, kind: 'openai_compatible', baseUrl: url });
    refresh();
    setShowCreate(false);
    setNewId(''); setNewName(''); setNewUrl('');
    toast.success('Provider added');
  };

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
        <strong>AI Providers — keys stored locally, endpoints shared</strong>
        <span className="text-secondary text-sm">{open ? '▼' : '▶'}</span>
      </div>
      {open && (
        <div style={{ padding: 12, borderTop: '1px solid var(--accent)' }}>
          <p className="text-secondary text-sm" style={{ marginTop: 0 }}>
            Each SDR workflow layer picks a provider from this list. Your API key is kept in your browser only; the endpoint definitions sync across the team so anyone can re-use the same provider list.
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCreate(true)}>
              + Add OpenAI-compatible provider
            </button>
          </div>

          {providers.map((p) => (
            <div
              key={p.id}
              style={{
                marginBottom: 10,
                padding: 12,
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              <div className="settings-row" style={{ gap: 8, alignItems: 'center' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">NAME</label>
                  <input
                    className="input"
                    value={p.name}
                    onChange={(e) => updateField(p.id, { name: e.target.value })}
                    disabled={BUILTIN_IDS.has(p.id) ? false : false}
                  />
                </div>
                <div className="form-group" style={{ width: 170 }}>
                  <label className="form-label">KIND</label>
                  <input className="input" value={p.kind} disabled readOnly />
                </div>
                <div className="form-group" style={{ width: 110 }}>
                  <label className="form-label">ID</label>
                  <input className="input" value={p.id} disabled readOnly />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">BASE URL</label>
                <input
                  className="input"
                  value={p.baseUrl || ''}
                  onChange={(e) => updateField(p.id, { baseUrl: e.target.value })}
                  spellCheck={false}
                />
              </div>
              <div className="form-group">
                <label className="form-label">API KEY (THIS BROWSER ONLY)</label>
                <input
                  className="input"
                  type="password"
                  value={keys[p.id] || ''}
                  onChange={(e) => updateKey(p.id, e.target.value)}
                  placeholder={p.kind === 'anthropic' ? 'sk-ant-…' : 'sk-… / eyJ… / provider key'}
                  spellCheck={false}
                />
              </div>
              {!BUILTIN_IDS.has(p.id) && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p)}>
                    Delete provider
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add OpenAI-compatible provider</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="form-group mb-16">
                <label className="form-label">Short ID (lowercase, a-z 0-9 -)</label>
                <input
                  className="input"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="e.g. together"
                  autoFocus
                />
              </div>
              <div className="form-group mb-16">
                <label className="form-label">Display name</label>
                <input
                  className="input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Together AI"
                />
              </div>
              <div className="form-group mb-16">
                <label className="form-label">Base URL (chat completions endpoint)</label>
                <input
                  className="input"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://api.together.xyz/v1/chat/completions"
                  spellCheck={false}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
