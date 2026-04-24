import { useState } from 'react';
import { getSdrWorkflows, saveSdrWorkflow, deleteSdrWorkflow } from '../utils/storage';
import { SDR_WORKFLOW_TOKENS } from '../utils/sdr';
import HighlightedTextarea from './HighlightedTextarea';
import { useToast } from './Toast';

// Collapsible, accent-tinted card listing all SDR workflows.
// Each workflow: name + description + prompt template.
// Projects pick which workflow to use via the AI SDR Playground tab.
export default function SdrWorkflowsEditor() {
  const [open, setOpen] = useState(false);
  const [workflows, setWorkflows] = useState(() => getSdrWorkflows());
  const [expandedIds, setExpandedIds] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const toast = useToast();

  const refresh = () => setWorkflows(getSdrWorkflows());

  const toggleId = (id) => setExpandedIds((p) => ({ ...p, [id]: !p[id] }));

  const handleCreate = (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    const defaultPrompt = (workflows[0]?.prompt) || '';
    saveSdrWorkflow({
      id,
      name,
      description: newDesc.trim(),
      prompt: defaultPrompt,
      createdAt: new Date().toISOString(),
    });
    refresh();
    setExpandedIds((p) => ({ ...p, [id]: true }));
    setShowCreate(false);
    setNewName('');
    setNewDesc('');
    toast.success('Workflow created');
  };

  const updateField = (id, patch) => {
    const list = getSdrWorkflows();
    const found = list.find((w) => w.id === id);
    if (!found) return;
    saveSdrWorkflow({ ...found, ...patch });
    refresh();
  };

  const handleDelete = (w) => {
    if (workflows.length <= 1) {
      toast.error('At least one workflow must exist');
      return;
    }
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
        style={{
          padding: 10,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <strong>AI SDR Workflows — shared (your IP)</strong>
        <span className="text-secondary text-sm">{open ? '▼' : '▶'}</span>
      </div>
      {open && (
        <div style={{ padding: 12, borderTop: '1px solid var(--accent)' }}>
          <p className="text-secondary text-sm" style={{ marginTop: 0 }}>
            Each workflow is a prompt template that drives how the AI SDR replies inside the playground.
            Supported variables:
            {' '}
            <span className="text-sm" style={{ fontFamily: 'ui-monospace, Space Mono, monospace' }}>
              {SDR_WORKFLOW_TOKENS.map((t) => `{${t}}`).join(', ')}
            </span>.
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCreate(true)}>
              + New workflow
            </button>
          </div>

          {workflows.map((w) => {
            const isOpen = !!expandedIds[w.id];
            return (
              <div key={w.id} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
                <div
                  style={{
                    padding: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  onClick={() => toggleId(w.id)}
                >
                  <div>
                    <strong>{w.name}</strong>
                    {w.description && (
                      <span className="text-secondary text-sm" style={{ marginLeft: 10 }}>
                        {w.description}
                      </span>
                    )}
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
                          onChange={(e) => updateField(w.id, { name: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">DESCRIPTION</label>
                      <input
                        className="input"
                        value={w.description || ''}
                        onChange={(e) => updateField(w.id, { description: e.target.value })}
                        placeholder="Short tagline, e.g. 'Warm, consultative, short.'"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">PROMPT</label>
                      <HighlightedTextarea
                        rows={14}
                        value={w.prompt || ''}
                        onChange={(e) => updateField(w.id, { prompt: e.target.value })}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(w)}>
                        Delete workflow
                      </button>
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
                  placeholder="e.g. Aggressive closer"
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
                The new workflow is seeded with a copy of the existing first workflow's prompt. You can edit it afterwards.
              </p>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
