import { useState } from 'react';
import { getSdrWorkflows, saveSdrWorkflow, deleteSdrWorkflow, getAiProviders } from '../utils/storage';
import { SDR_WORKFLOW_TOKENS } from '../utils/sdr';
import HighlightedTextarea from './HighlightedTextarea';
import { useToast } from './Toast';

// Collapsible, accent-tinted card listing all SDR workflows.
// Each workflow has an ordered list of layers. A layer = provider + model +
// system message + temperature + content template.
export default function SdrWorkflowsEditor() {
  const [open, setOpen] = useState(false);
  const [workflows, setWorkflows] = useState(() => getSdrWorkflows());
  const [expandedIds, setExpandedIds] = useState({});
  const [expandedLayers, setExpandedLayers] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const toast = useToast();

  const providers = getAiProviders();
  const refresh = () => setWorkflows(getSdrWorkflows());
  const toggleWorkflow = (id) => setExpandedIds((p) => ({ ...p, [id]: !p[id] }));
  const toggleLayer = (id) => setExpandedLayers((p) => ({ ...p, [id]: !p[id] }));

  const randomId = (prefix = '') => {
    const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return prefix ? `${prefix}-${uuid.slice(0, 8)}` : uuid;
  };

  const emptyLayer = (workflowId, nameHint) => ({
    id: randomId(`${workflowId}-layer`),
    name: nameHint || 'Layer',
    description: '',
    providerId: providers[0]?.id || 'anthropic',
    model: providers[0]?.kind === 'anthropic' ? 'claude-sonnet-4-20250514' : '',
    systemMessage: '',
    temperature: 0.6,
    content: '',
  });

  const handleCreate = (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const id = randomId('wf');
    const seed = workflows[0]?.layers?.[0];
    const layer = seed
      ? { ...seed, id: randomId(`${id}-layer`), name: 'Layer 1' }
      : emptyLayer(id, 'Layer 1');
    saveSdrWorkflow({
      id,
      name,
      description: newDesc.trim(),
      layers: [layer],
      createdAt: new Date().toISOString(),
    });
    refresh();
    setExpandedIds((p) => ({ ...p, [id]: true }));
    setShowCreate(false);
    setNewName(''); setNewDesc('');
    toast.success('Workflow created');
  };

  const updateWorkflow = (id, patch) => {
    const list = getSdrWorkflows();
    const found = list.find((w) => w.id === id);
    if (!found) return;
    saveSdrWorkflow({ ...found, ...patch });
    refresh();
  };

  const updateLayer = (workflowId, layerIdx, patch) => {
    const list = getSdrWorkflows();
    const found = list.find((w) => w.id === workflowId);
    if (!found) return;
    const layers = (found.layers || []).map((l, i) => (i === layerIdx ? { ...l, ...patch } : l));
    saveSdrWorkflow({ ...found, layers });
    refresh();
  };

  const moveLayer = (workflowId, layerIdx, dir) => {
    const list = getSdrWorkflows();
    const found = list.find((w) => w.id === workflowId);
    if (!found) return;
    const layers = [...(found.layers || [])];
    const j = layerIdx + dir;
    if (j < 0 || j >= layers.length) return;
    [layers[layerIdx], layers[j]] = [layers[j], layers[layerIdx]];
    saveSdrWorkflow({ ...found, layers });
    refresh();
  };

  const addLayer = (workflowId) => {
    const list = getSdrWorkflows();
    const found = list.find((w) => w.id === workflowId);
    if (!found) return;
    const layers = [...(found.layers || []), emptyLayer(workflowId, `Layer ${(found.layers?.length || 0) + 1}`)];
    saveSdrWorkflow({ ...found, layers });
    refresh();
  };

  const removeLayer = (workflowId, layerIdx) => {
    const list = getSdrWorkflows();
    const found = list.find((w) => w.id === workflowId);
    if (!found) return;
    if ((found.layers || []).length <= 1) { toast.error('A workflow needs at least one layer'); return; }
    if (!window.confirm('Delete this layer?')) return;
    const layers = found.layers.filter((_, i) => i !== layerIdx);
    saveSdrWorkflow({ ...found, layers });
    refresh();
  };

  const handleDeleteWorkflow = (w) => {
    if (workflows.length <= 1) { toast.error('At least one workflow must exist'); return; }
    if (!window.confirm(`Delete workflow "${w.name}"?`)) return;
    deleteSdrWorkflow(w.id);
    refresh();
    toast.success('Workflow deleted');
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
        style={{ padding: 10, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setOpen((v) => !v)}
      >
        <strong>AI SDR Workflows — shared (your IP)</strong>
        <span className="text-secondary text-sm">{open ? '▼' : '▶'}</span>
      </div>
      {open && (
        <div style={{ padding: 12, borderTop: '1px solid var(--accent)' }}>
          <p className="text-secondary text-sm" style={{ marginTop: 0 }}>
            Each workflow is an ordered list of layers. Layer 1 usually classifies the situation; Layer 2 uses that classification to write the reply. Available variables:{' '}
            <span style={{ fontFamily: 'ui-monospace, Space Mono, monospace' }}>
              {SDR_WORKFLOW_TOKENS.map((t) => `{${t}}`).join(', ')}
            </span>.
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCreate(true)}>+ New workflow</button>
          </div>

          {workflows.map((w) => {
            const isOpen = !!expandedIds[w.id];
            return (
              <div key={w.id} style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 6 }}>
                <div
                  style={{ padding: 10, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => toggleWorkflow(w.id)}
                >
                  <div>
                    <strong>{w.name}</strong>
                    {w.description && <span className="text-secondary text-sm" style={{ marginLeft: 10 }}>{w.description}</span>}
                    <span className="text-secondary text-sm" style={{ marginLeft: 10 }}>
                      {(w.layers || []).length} layer{(w.layers || []).length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <span className="text-secondary text-sm">{isOpen ? '▼' : '▶'}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
                    <div className="settings-row" style={{ gap: 8 }}>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label className="form-label">NAME</label>
                        <input
                          className="input"
                          value={w.name}
                          onChange={(e) => updateWorkflow(w.id, { name: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">DESCRIPTION</label>
                      <input
                        className="input"
                        value={w.description || ''}
                        onChange={(e) => updateWorkflow(w.id, { description: e.target.value })}
                      />
                    </div>

                    {(w.layers || []).map((layer, idx) => {
                      const lOpen = !!expandedLayers[layer.id];
                      return (
                        <div key={layer.id} style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
                          <div
                            style={{ padding: 10, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onClick={() => toggleLayer(layer.id)}
                          >
                            <div>
                              <strong>Layer {idx + 1}: {layer.name || '(unnamed)'}</strong>
                              <span className="text-secondary text-sm" style={{ marginLeft: 10 }}>
                                {providers.find((p) => p.id === layer.providerId)?.name || layer.providerId || '—'} · {layer.model || '—'}
                              </span>
                            </div>
                            <span className="text-secondary text-sm">{lOpen ? '▼' : '▶'}</span>
                          </div>
                          {lOpen && (
                            <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
                              <div className="settings-row" style={{ gap: 8 }}>
                                <div className="form-group" style={{ flex: 1 }}>
                                  <label className="form-label">LAYER NAME</label>
                                  <input
                                    className="input"
                                    value={layer.name || ''}
                                    onChange={(e) => updateLayer(w.id, idx, { name: e.target.value })}
                                  />
                                </div>
                                <div className="form-group" style={{ width: 210 }}>
                                  <label className="form-label">PROVIDER</label>
                                  <select
                                    className="input"
                                    value={layer.providerId}
                                    onChange={(e) => updateLayer(w.id, idx, { providerId: e.target.value })}
                                  >
                                    {providers.map((p) => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="form-group" style={{ width: 260 }}>
                                  <label className="form-label">MODEL</label>
                                  <input
                                    className="input"
                                    value={layer.model || ''}
                                    onChange={(e) => updateLayer(w.id, idx, { model: e.target.value })}
                                    spellCheck={false}
                                  />
                                </div>
                                <div className="form-group" style={{ width: 120 }}>
                                  <label className="form-label">TEMPERATURE</label>
                                  <input
                                    className="input"
                                    type="number"
                                    min={0}
                                    max={2}
                                    step={0.1}
                                    value={layer.temperature ?? 0.6}
                                    onChange={(e) => updateLayer(w.id, idx, { temperature: Number(e.target.value) })}
                                  />
                                </div>
                              </div>

                              <div className="form-group">
                                <label className="form-label">DESCRIPTION</label>
                                <input
                                  className="input"
                                  value={layer.description || ''}
                                  onChange={(e) => updateLayer(w.id, idx, { description: e.target.value })}
                                  placeholder="What this layer does"
                                />
                              </div>
                              <div className="form-group">
                                <label className="form-label">SYSTEM MESSAGE</label>
                                <HighlightedTextarea
                                  rows={4}
                                  value={layer.systemMessage || ''}
                                  onChange={(e) => updateLayer(w.id, idx, { systemMessage: e.target.value })}
                                />
                              </div>
                              <div className="form-group">
                                <label className="form-label">CONTENT (PROMPT TEMPLATE)</label>
                                <HighlightedTextarea
                                  rows={14}
                                  value={layer.content || ''}
                                  onChange={(e) => updateLayer(w.id, idx, { content: e.target.value })}
                                />
                              </div>

                              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button className="btn btn-ghost btn-sm" onClick={() => moveLayer(w.id, idx, -1)} disabled={idx === 0}>↑ Move up</button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => moveLayer(w.id, idx, 1)} disabled={idx === (w.layers.length - 1)}>↓ Move down</button>
                                </div>
                                <button className="btn btn-danger btn-sm" onClick={() => removeLayer(w.id, idx)}>Delete layer</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 8 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => addLayer(w.id)}>+ Add layer</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeleteWorkflow(w)}>Delete workflow</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New SDR Workflow</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="form-group mb-16">
                <label className="form-label">Name</label>
                <input
                  className="input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Two-layer classifier + execute"
                  autoFocus
                />
              </div>
              <div className="form-group mb-16">
                <label className="form-label">Description</label>
                <input
                  className="input"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Short tagline"
                />
              </div>
              <p className="text-secondary text-sm">
                Seeded with a single empty layer (copied from the first existing workflow when available). Add more layers afterwards.
              </p>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
