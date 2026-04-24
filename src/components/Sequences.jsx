import React, { useState, useEffect, useRef, useCallback } from 'react';
import { diffOutputWithTemplate, buildVarMap, generateMessage } from '../utils/ai';
import { getApiKey, getCustomer } from '../utils/storage';
import { downloadSequencesXlsx } from '../utils/exportSequences';
import SequenceEditor from './SequenceEditor';
import HighlightedTextarea from './HighlightedTextarea';
import { useToast } from './Toast';

export default function Sequences({ project, updateProject, shareMode = false }) {
  const [editingId, setEditingId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [promptModal, setPromptModal] = useState(null); // { seqId, message, seqName, output }
  const [promptDraft, setPromptDraft] = useState('');
  const [descriptionsOpen, setDescriptionsOpen] = useState(false);
  const outputs = project.outputs || {};
  const [regeneratingId, setRegeneratingId] = useState(null);
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

  // Outputs now come from project.outputs (synced via updateProject),
  // so we no longer need the storage-poll mechanism.

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

  const handleRegenerateSeq = async (seq) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error('Set your Anthropic API key in Settings first');
      return;
    }
    const lead = project.lead || {};
    const varMap = buildVarMap(lead, project);
    setRegeneratingId(seq.id);
    const currentOutputs = { ...(project.outputs || {}) };
    for (const msg of seq.messages) {
      try {
        const result = await generateMessage(msg, varMap, apiKey, project.language || 'en');
        currentOutputs[msg.id] = result;
        updateProject({ outputs: { ...currentOutputs } });
      } catch (err) {
        toast.error(`Failed: ${msg.label}: ${err.message}`);
      }
      if (msg.type === 'ai') await new Promise((r) => setTimeout(r, 800));
    }
    setRegeneratingId(null);
    toast.success(`${seq.name} regenerated`);
  };

  const handleShare = () => {
    const token = crypto.randomUUID();
    updateProject({ shareToken: token });
    const url = `${window.location.origin}/share/${token}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    toast.success('Share link copied to clipboard');
  };

  const handleCopyShare = () => {
    if (!project.shareToken) return;
    const url = `${window.location.origin}/share/${project.shareToken}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    toast.success('Share link copied');
  };

  const handleRevokeShare = () => {
    if (!confirm('Revoke the share link? Anyone with the old link will see an error page.')) return;
    updateProject({ shareToken: null });
    toast.success('Share link revoked');
  };

  const handleExportXlsx = () => {
    try {
      const customer = project.customerId ? getCustomer(project.customerId) : null;
      const customerName = customer?.name || project.clientName || '';
      downloadSequencesXlsx({ project, customerName });
      toast.success('Excel file downloaded');
    } catch (err) {
      toast.error('Export failed: ' + err.message);
    }
  };

  // Seed the prompt-edit draft whenever the viewer modal opens.
  useEffect(() => {
    if (promptModal) setPromptDraft(promptModal.message.prompt);
  }, [promptModal]);

  const handleSavePrompt = () => {
    if (!promptModal) return;
    const seqs = project.sequences.map((s) => {
      if (s.id !== promptModal.seqId) return s;
      const messages = s.messages.map((m) =>
        m.id === promptModal.message.id ? { ...m, prompt: promptDraft } : m
      );
      return { ...s, messages };
    });
    updateProject({ sequences: seqs });
    toast.success('Message saved');
    setPromptModal(null);
  };

  const handleDeleteSequence = (id) => {
    if (!confirm('Delete this sequence?')) return;
    const seq = project.sequences.find((s) => s.id === id);
    if (!seq) return;
    const existing = Array.isArray(project.deletedSequences) ? project.deletedSequences : [];
    updateProject({
      sequences: project.sequences.filter((s) => s.id !== id),
      deletedSequences: [seq, ...existing.filter((s) => s.id !== id)],
    });
    toast.success('Sequence deleted — recoverable on Overview');
  };

  const editingSeq = project.sequences.find((s) => s.id === editingId);

  // Find max message count across sequences
  const maxMessages = Math.max(...project.sequences.map((s) => s.messages.length), 0);

  return (
    <>
      <div className="flex-between mb-16">
        <h3>{project.sequences.length} Sequences</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setDescriptionsOpen((v) => !v)}
            title={descriptionsOpen ? 'Hide descriptions' : 'Show descriptions'}
          >
            {descriptionsOpen ? 'Hide descriptions' : 'Show descriptions'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportXlsx} title="Download these sequences as an .xlsx file">
            Export Excel
          </button>
          {!shareMode && (project.shareToken ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={handleCopyShare} title="Copy the collaboration link">
                Copy share link
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleRevokeShare}>
                Revoke share
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={handleShare} title="Generate a collaboration link anyone can edit">
              Share link (edit)
            </button>
          ))}
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
            {project.sequences.map((seq) => {
              const hasDesc = !!(seq.description && seq.description.trim());
              return (
              <div key={seq.id} className="seq-col-header seq-col-header-stacked">
                <div className="seq-col-header-row">
                  <span className="seq-col-name">{seq.name}</span>
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
                    <button
                      className="seq-regen-btn seq-delete-btn"
                      title="Delete sequence"
                      onClick={() => handleDeleteSequence(seq.id)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                    <span className="text-secondary text-sm seq-edit-link" onClick={() => setEditingId(seq.id)}>Edit</span>
                  </div>
                </div>
                {descriptionsOpen && (
                  <div className="seq-col-description">
                    {hasDesc ? seq.description : <em>No description</em>}
                  </div>
                )}
              </div>
              );
            })}

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
                      onClick={() => setPromptModal({ seqId: seq.id, message: msg, seqName: seq.name, output })}
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
          shareMode={shareMode}
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
                {promptDraft !== promptModal.message.prompt && (
                  <div className="text-secondary text-sm" style={{ marginTop: 6 }}>
                    Template changed — regenerate to refresh the output.
                  </div>
                )}
              </div>
            )}
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Message Template</div>
              <HighlightedTextarea
                rows={14}
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPromptModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSavePrompt}
                disabled={promptDraft === promptModal.message.prompt}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
