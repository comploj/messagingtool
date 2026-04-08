import { useState, useEffect } from 'react';
import { highlightVars } from '../utils/ai';
import SequenceEditor from './SequenceEditor';
import { useToast } from './Toast';

const OUTPUTS_KEY = (id) => `leadhunt_outputs_${id}`;

function loadOutputs(projectId) {
  try { return JSON.parse(localStorage.getItem(OUTPUTS_KEY(projectId))) || {}; }
  catch { return {}; }
}

export default function Sequences({ project, updateProject }) {
  const [editingId, setEditingId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [promptModal, setPromptModal] = useState(null); // { message, seqName }
  const [outputs, setOutputs] = useState(() => loadOutputs(project.id));
  const toast = useToast();

  // Re-read outputs when tab is visited (they may have been generated in Overview)
  useEffect(() => {
    const refresh = () => setOutputs(loadOutputs(project.id));
    refresh();
    window.addEventListener('storage', refresh);
    // Also poll briefly since storage event doesn't fire in same tab
    const interval = setInterval(refresh, 1000);
    return () => {
      window.removeEventListener('storage', refresh);
      clearInterval(interval);
    };
  }, [project.id]);

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const seq = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      description: newDesc.trim(),
      messages: [],
    };
    updateProject({ sequences: [...project.sequences, seq] });
    setShowCreate(false);
    setNewName('');
    setNewDesc('');
    toast.success('Sequence created');
  };

  const handleSaveSequence = (updated) => {
    const seqs = project.sequences.map((s) => (s.id === updated.id ? updated : s));
    updateProject({ sequences: seqs });
    setEditingId(null);
    toast.success('Sequence saved');
  };

  const handleDeleteSequence = (id) => {
    if (!confirm('Delete this sequence?')) return;
    updateProject({ sequences: project.sequences.filter((s) => s.id !== id) });
    toast.success('Sequence deleted');
  };

  const editingSeq = project.sequences.find((s) => s.id === editingId);

  // Find max message count across sequences
  const maxMessages = Math.max(...project.sequences.map((s) => s.messages.length), 0);

  return (
    <>
      <div className="flex-between mb-16">
        <h3>{project.sequences.length} Sequences</h3>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Add Sequence
        </button>
      </div>

      {project.sequences.length === 0 ? (
        <div className="empty-state">
          <h3>No sequences</h3>
          <p>Add your first message sequence.</p>
        </div>
      ) : (
        <div className="seq-spreadsheet-wrapper">
          <div className="seq-spreadsheet">
            {/* Row labels column */}
            <div className="seq-row-labels">
              <div className="seq-col-header seq-row-label-header"></div>
              {Array.from({ length: maxMessages }, (_, i) => (
                <div key={i} className="seq-row-label">Message {i + 1}</div>
              ))}
            </div>

            {/* Sequence columns */}
            {project.sequences.map((seq) => (
              <div key={seq.id} className="seq-column">
                <div className="seq-col-header" onClick={() => setEditingId(seq.id)}>
                  <span className="seq-col-name">{seq.name}</span>
                  <span className="text-secondary text-sm">Edit</span>
                </div>
                {seq.messages.map((msg, i) => {
                  const output = outputs[msg.id];
                  return (
                    <div
                      key={msg.id}
                      className={`seq-cell ${output ? 'seq-cell-filled' : ''}`}
                      onClick={() => setPromptModal({ message: msg, seqName: seq.name, output })}
                    >
                      <div className="seq-cell-badges">
                        <span className={`badge ${msg.type === 'ai' ? 'badge-ai' : 'badge-static'}`}>
                          {msg.type}
                        </span>
                        <span className="badge badge-delay">Day {msg.delayDays}</span>
                      </div>
                      <div className="seq-cell-text">
                        {output || 'Not generated yet'}
                      </div>
                    </div>
                  );
                })}
                {/* Fill empty cells if this seq has fewer messages */}
                {Array.from({ length: maxMessages - seq.messages.length }, (_, i) => (
                  <div key={`empty-${i}`} className="seq-cell seq-cell-empty">—</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Sequence</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="form-group mb-16">
                <label className="form-label">Name</label>
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Cold Outreach" autoFocus />
              </div>
              <div className="form-group mb-16">
                <label className="form-label">Description</label>
                <textarea className="textarea" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Brief description..." rows={3} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sequence editor modal */}
      {editingSeq && (
        <SequenceEditor
          sequence={editingSeq}
          onSave={handleSaveSequence}
          onDelete={() => handleDeleteSequence(editingSeq.id)}
          onClose={() => setEditingId(null)}
        />
      )}

      {/* Prompt viewer modal */}
      {promptModal && (
        <div className="modal-overlay" onClick={() => setPromptModal(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{promptModal.seqName} — {promptModal.message.label}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setPromptModal(null)}>&times;</button>
            </div>
            <div className="prompt-view-badges" style={{ marginBottom: 16 }}>
              <span className={`badge ${promptModal.message.type === 'ai' ? 'badge-ai' : 'badge-static'}`}>
                {promptModal.message.type}
              </span>
              <span className="badge badge-delay">Day {promptModal.message.delayDays}</span>
            </div>
            {promptModal.output && (
              <div style={{ marginBottom: 20 }}>
                <div className="form-label" style={{ marginBottom: 8 }}>Output</div>
                <div className="prompt-view-output">{promptModal.output}</div>
              </div>
            )}
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Prompt Template</div>
              <div className="prompt-view-template">
                {highlightVars(promptModal.message.prompt).map((seg, i) =>
                  seg.type === 'var' ? (
                    <span key={i} className={`var-chip ${seg.isOp ? 'var-chip-op' : 'var-chip-regular'}`}>{seg.value}</span>
                  ) : (
                    <span key={i}>{seg.value}</span>
                  )
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPromptModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
