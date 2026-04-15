import React, { useState, useEffect, useRef, useCallback } from 'react';
import { highlightVars, diffOutputWithTemplate, buildVarMap, generateMessage } from '../utils/ai';
import { getApiKey } from '../utils/storage';
import SequenceEditor from './SequenceEditor';
import { useToast } from './Toast';

const OUTPUTS_KEY = (id) => `leadhunt_outputs_${id}`;
const LEAD_KEY = (id) => `leadhunt_lead_${id}`;

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
  const [regeneratingId, setRegeneratingId] = useState(null);
  const [selectedSeqs, setSelectedSeqs] = useState(new Set());
  const toast = useToast();
  const wrapperRef = useRef(null);
  const stickyScrollRef = useRef(null);
  const scrollInnerRef = useRef(null);

  // Sync sticky scrollbar with main wrapper
  const syncingRef = useRef(false);
  const handleWrapperScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (stickyScrollRef.current) stickyScrollRef.current.scrollLeft = wrapperRef.current.scrollLeft;
    syncingRef.current = false;
  }, []);
  const handleStickyScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (wrapperRef.current) wrapperRef.current.scrollLeft = stickyScrollRef.current.scrollLeft;
    syncingRef.current = false;
  }, []);

  // Set the inner width of the sticky scrollbar to match the spreadsheet width
  useEffect(() => {
    if (!wrapperRef.current || !scrollInnerRef.current) return;
    const updateWidth = () => {
      if (wrapperRef.current && scrollInnerRef.current) {
        scrollInnerRef.current.style.width = wrapperRef.current.scrollWidth + 'px';
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [project.sequences.length]);

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

  const handleDelayChange = (seqId, msgIdx, newDelay) => {
    const seqs = project.sequences.map((s) => {
      if (s.id !== seqId) return s;
      const messages = s.messages.map((m, i) =>
        i === msgIdx ? { ...m, delayDays: Math.max(1, parseInt(newDelay) || 1) } : m
      );
      return { ...s, messages };
    });
    updateProject({ sequences: seqs });
  };

  const toggleSelectSeq = (id) => {
    setSelectedSeqs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (selectedSeqs.size === 0) return;
    if (!confirm(`Delete ${selectedSeqs.size} selected sequence(s)?`)) return;
    updateProject({ sequences: project.sequences.filter((s) => !selectedSeqs.has(s.id)) });
    setSelectedSeqs(new Set());
    toast.success(`${selectedSeqs.size} sequence(s) deleted`);
  };

  const handleRegenerateSeq = async (seq) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error('Set your Anthropic API key in Settings first');
      return;
    }
    let lead = {};
    try { lead = JSON.parse(localStorage.getItem(LEAD_KEY(project.id))) || {}; } catch {}
    const varMap = buildVarMap(lead, project);
    setRegeneratingId(seq.id);
    const currentOutputs = { ...outputs };
    for (const msg of seq.messages) {
      try {
        const result = await generateMessage(msg, varMap, apiKey);
        currentOutputs[msg.id] = result;
        setOutputs({ ...currentOutputs });
        localStorage.setItem(OUTPUTS_KEY(project.id), JSON.stringify(currentOutputs));
      } catch (err) {
        toast.error(`Failed: ${msg.label}: ${err.message}`);
      }
      if (msg.type === 'ai') await new Promise((r) => setTimeout(r, 800));
    }
    setRegeneratingId(null);
    toast.success(`${seq.name} regenerated`);
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
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedSeqs.size > 0 && (
            <button className="btn btn-danger btn-sm" onClick={handleDeleteSelected}>
              Delete ({selectedSeqs.size})
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Add Sequence
          </button>
        </div>
      </div>

      {project.sequences.length === 0 ? (
        <div className="empty-state">
          <h3>No sequences</h3>
          <p>Add your first message sequence.</p>
        </div>
      ) : (
        <>
        <div className="seq-sticky-scroll" ref={stickyScrollRef} onScroll={handleStickyScroll}>
          <div ref={scrollInnerRef} style={{ height: 1 }} />
        </div>
        <div className="seq-spreadsheet-wrapper" ref={wrapperRef} onScroll={handleWrapperScroll}>
          <div
            className="seq-spreadsheet"
            style={{
              gridTemplateColumns: `100px repeat(${project.sequences.length}, 450px)`,
              gridTemplateRows: `auto repeat(${maxMessages}, auto)`,
            }}
          >
            {/* Header row */}
            <div className="seq-corner-header"></div>
            {project.sequences.map((seq) => (
              <div key={seq.id} className={`seq-col-header ${selectedSeqs.has(seq.id) ? 'seq-col-selected' : ''}`}>
                <div className="seq-col-name-row">
                  <input
                    type="checkbox"
                    className="seq-col-checkbox"
                    checked={selectedSeqs.has(seq.id)}
                    onChange={() => toggleSelectSeq(seq.id)}
                  />
                  <span className="seq-col-name">{seq.name}</span>
                </div>
                <div className="seq-col-actions">
                  <button
                    className="seq-regen-btn"
                    title="Regenerate all messages"
                    onClick={() => handleRegenerateSeq(seq)}
                    disabled={regeneratingId === seq.id}
                  >
                    {regeneratingId === seq.id
                      ? <span className="spinner spinner-sm"></span>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                    }
                  </button>
                  <span className="text-secondary text-sm seq-edit-link" onClick={() => setEditingId(seq.id)}>Edit</span>
                </div>
              </div>
            ))}

            {/* Data rows with delay rows between them */}
            {Array.from({ length: maxMessages }, (_, rowIdx) => (
              <React.Fragment key={`row-${rowIdx}`}>
                {/* Message row */}
                <div className="seq-row-label">Message {rowIdx + 1}</div>
                {project.sequences.map((seq) => {
                  const msg = seq.messages[rowIdx];
                  if (!msg) return <div key={`${seq.id}-empty-${rowIdx}`} className="seq-cell seq-cell-empty">—</div>;
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
                      </div>
                      <div className="seq-cell-text">
                        {output
                          ? diffOutputWithTemplate(msg.prompt, output).map((seg, si) =>
                              seg.type === 'generated'
                                ? <span key={si} className="output-generated">{seg.value}</span>
                                : <span key={si}>{seg.value}</span>
                            )
                          : 'Not generated yet'}
                      </div>
                    </div>
                  );
                })}

                {/* Delay row (between messages, not after the last one) */}
                {rowIdx < maxMessages - 1 && (
                  <>
                    <div className="seq-delay-label">Delay</div>
                    {project.sequences.map((seq) => {
                      const nextMsg = seq.messages[rowIdx + 1];
                      if (!nextMsg) return <div key={`${seq.id}-delay-empty-${rowIdx}`} className="seq-delay-cell">—</div>;
                      return (
                        <div key={`${seq.id}-delay-${rowIdx}`} className="seq-delay-cell">
                          <input
                            className="input seq-delay-input"
                            type="number"
                            min={1}
                            value={nextMsg.delayDays}
                            onChange={(e) => handleDelayChange(seq.id, rowIdx + 1, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="seq-delay-unit">days</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
        </>
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
                <div className="prompt-view-output">
                  {diffOutputWithTemplate(promptModal.message.prompt, promptModal.output).map((seg, i) =>
                    seg.type === 'generated'
                      ? <span key={i} className="output-generated">{seg.value}</span>
                      : <span key={i}>{seg.value}</span>
                  )}
                </div>
              </div>
            )}
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Prompt Template</div>
              <div className="prompt-view-template">
                {highlightVars(promptModal.message.prompt).map((seg, i) =>
                  seg.type === 'var' ? (
                    <span key={i} className={`var-chip ${seg.isOp ? 'var-chip-op' : 'var-chip-regular'}`}>{seg.value}</span>
                  ) : seg.type === 'bracket' ? (
                    <span key={i} className="var-chip var-chip-bracket">{seg.value}</span>
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
