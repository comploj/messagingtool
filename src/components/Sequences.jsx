import React, { useState, useEffect, useRef, useCallback } from 'react';
import { diffOutputWithTemplate, buildVarMap, generateMessage } from '../utils/ai';
import { getApiKey, getCustomer, getDefaultMessageModel, getAiProvider, flushSyncNow, applyShareTokenLocal } from '../utils/storage';
import { createProjectShare, deleteProjectShare } from '../utils/apiClient';
import { downloadSequencesXlsx } from '../utils/exportSequences';
import SequenceEditor from './SequenceEditor';
import HighlightedTextarea from './HighlightedTextarea';
import { useToast } from './Toast';

// Filled thumb icons — more recognizable than the stroke-only Lucide ones.
// Mid is a thumbs-up rotated 90° to read as "horizontal / maybe".
function ThumbUpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 21h3.5V9H2v12zm19.5-9h-6.32l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.67 4l-6.59 6.59C7.71 10.95 7.5 11.45 7.5 12v8c0 1.1.9 2 2 2h7.5c.79 0 1.5-.45 1.84-1.16l3.02-7.04c.09-.23.14-.47.14-.73V12c0-.55-.45-1-1-1z" />
    </svg>
  );
}
function ThumbMidIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ transform: 'rotate(90deg)' }}>
      <path d="M2 21h3.5V9H2v12zm19.5-9h-6.32l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.67 4l-6.59 6.59C7.71 10.95 7.5 11.45 7.5 12v8c0 1.1.9 2 2 2h7.5c.79 0 1.5-.45 1.84-1.16l3.02-7.04c.09-.23.14-.47.14-.73V12c0-.55-.45-1-1-1z" />
    </svg>
  );
}
function ThumbDownIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22 3h-3.5v12H22V3zM2.5 12c0 .26.05.5.14.73l3.02 7.04C6 20.55 6.71 21 7.5 21H15c1.1 0 2-.9 2-2v-8c0-.55-.21-1.05-.58-1.41L9.83 3 9.21 3.62c-.27.27-.44.65-.44 1.06l.03.32.95 4.57H3.5c-.55 0-1 .45-1 1v1.43z" />
    </svg>
  );
}

export default function Sequences({ project, updateProject, shareMode = false, shareToken = null }) {
  // Share viewers proxy through the server (owner's stored key + chosen
  // provider). Logged-in users dispatch directly via the configured default
  // message-generation provider — the key it needs is the one for that
  // provider, not necessarily Anthropic.
  const getAiCtx = () => {
    if (shareMode && shareToken) return { shareToken };
    const cfg = getDefaultMessageModel();
    const apiKey = getApiKey(cfg.providerId);
    if (!apiKey) return null;
    return {};
  };
  const missingKeyMessage = () => {
    const cfg = getDefaultMessageModel();
    const provider = getAiProvider(cfg.providerId);
    return `Set the API key for ${provider?.name || cfg.providerId} in Settings → AI Providers.`;
  };
  const aiErrorMessage = (err) => {
    if (err && err.ownerNoKey) return 'The owner has not set up an API key yet';
    return err?.message || 'Unknown error';
  };
  const [editingId, setEditingId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [promptModal, setPromptModal] = useState(null); // { seqId, message, seqName, output }
  const [promptDraft, setPromptDraft] = useState('');
  const [descriptionsOpen, setDescriptionsOpen] = useState(false);
  const outputs = project.outputs || {};
  const [regeneratingId, setRegeneratingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [bulkRegenerating, setBulkRegenerating] = useState(false);
  // 'all' | 'up' | 'mid' | 'down' | 'none' — filters which sequences appear in
  // the spreadsheet, bulk actions and Excel export.
  const [ratingFilter, setRatingFilter] = useState('all');
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

  // Drop selection IDs whose sequences were removed elsewhere.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(project.sequences.map((s) => s.id));
      let changed = false;
      const next = new Set();
      prev.forEach((id) => {
        if (ids.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [project.sequences]);

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
    const ctx = getAiCtx();
    if (!ctx) {
      toast.error(missingKeyMessage());
      return;
    }
    const lead = project.lead || {};
    const varMap = buildVarMap(lead, project);
    setRegeneratingId(seq.id);
    const currentOutputs = { ...(project.outputs || {}) };
    for (const msg of seq.messages) {
      try {
        const result = await generateMessage(msg, varMap, ctx, project.language || 'en');
        currentOutputs[msg.id] = result;
        updateProject({ outputs: { ...currentOutputs } });
      } catch (err) {
        toast.error(`Failed: ${msg.label}: ${aiErrorMessage(err)}`);
      }
      if (msg.type === 'ai') await new Promise((r) => setTimeout(r, 800));
    }
    setRegeneratingId(null);
    toast.success(`${seq.name} regenerated`);
  };

  const handleShare = async () => {
    // Atomic server-side issuance: avoids the localStorage→sync race where
    // a debounced PUT or a concurrent hydrate could clobber the token before
    // it reaches the server. The server returns the canonical token + the
    // bumped state version, and we patch our local cache to match.
    let result;
    try {
      result = await createProjectShare(project.id);
    } catch (err) {
      console.error('[share] create failed', err);
      toast.error('Could not save share link — please try again');
      return;
    }
    applyShareTokenLocal(project.id, result.token, result.version);
    updateProject({ shareToken: result.token });
    const url = `${window.location.origin}/share/${result.token}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    toast.success('Share link copied to clipboard');
  };

  const handleCopyShare = () => {
    if (!project.shareToken) return;
    const url = `${window.location.origin}/share/${project.shareToken}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    toast.success('Share link copied');
  };

  const handleRevokeShare = async () => {
    if (!confirm('Revoke the share link? Anyone with the old link will see an error page.')) return;
    let result;
    try {
      result = await deleteProjectShare(project.id);
    } catch (err) {
      console.error('[share] revoke failed', err);
      toast.error('Could not revoke share link — please try again');
      return;
    }
    applyShareTokenLocal(project.id, null, result.version);
    updateProject({ shareToken: null });
    toast.success('Share link revoked');
  };

  const handleExportXlsx = () => {
    try {
      const customer = project.customerId ? getCustomer(project.customerId) : null;
      const customerName = customer?.name || project.clientName || '';
      const filtered = project.sequences.filter(matchesFilter);
      if (filtered.length === 0) {
        toast.error('No sequences match the current rating filter');
        return;
      }
      downloadSequencesXlsx({ project: { ...project, sequences: filtered }, customerName });
      toast.success(
        ratingFilter === 'all'
          ? 'Excel file downloaded'
          : `Excel file downloaded (${filtered.length} of ${project.sequences.length} sequences)`
      );
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
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast.success('Sequence deleted — recoverable on Overview');
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmingBulkDelete(false);
  };

  const toggleSelectAll = () => {
    const visibleIds = project.sequences.filter(matchesFilter).map((s) => s.id);
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
    setConfirmingBulkDelete(false);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setConfirmingBulkDelete(false);
  };

  const handleBulkRegenerate = async () => {
    if (selectedIds.size === 0 || bulkRegenerating) return;
    const ctx = getAiCtx();
    if (!ctx) {
      toast.error(missingKeyMessage());
      return;
    }
    const seqs = project.sequences.filter((s) => selectedIds.has(s.id));
    if (seqs.length === 0) return;
    setBulkRegenerating(true);
    const lead = project.lead || {};
    const varMap = buildVarMap(lead, project);
    let currentOutputs = { ...(project.outputs || {}) };
    let failures = 0;
    for (const seq of seqs) {
      setRegeneratingId(seq.id);
      for (const msg of seq.messages) {
        try {
          const result = await generateMessage(msg, varMap, ctx, project.language || 'en');
          currentOutputs[msg.id] = result;
          updateProject({ outputs: { ...currentOutputs } });
        } catch (err) {
          failures += 1;
          toast.error(`Failed: ${seq.name} — ${msg.label}: ${aiErrorMessage(err)}`);
        }
        if (msg.type === 'ai') await new Promise((r) => setTimeout(r, 800));
      }
    }
    setRegeneratingId(null);
    setBulkRegenerating(false);
    if (failures === 0) {
      toast.success(`Regenerated ${seqs.length} sequence${seqs.length === 1 ? '' : 's'}`);
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    const toDelete = project.sequences.filter((s) => selectedIds.has(s.id));
    if (toDelete.length === 0) return;
    const existing = Array.isArray(project.deletedSequences) ? project.deletedSequences : [];
    const deletedIds = new Set(toDelete.map((s) => s.id));
    updateProject({
      sequences: project.sequences.filter((s) => !selectedIds.has(s.id)),
      deletedSequences: [...toDelete, ...existing.filter((s) => !deletedIds.has(s.id))],
    });
    const count = toDelete.length;
    setSelectedIds(new Set());
    setConfirmingBulkDelete(false);
    toast.success(`${count} sequence${count === 1 ? '' : 's'} deleted — recoverable on Overview`);
  };

  const handleRate = (seqId, value) => {
    const seqs = project.sequences.map((s) => {
      if (s.id !== seqId) return s;
      const current = s.rating || null;
      const next = current === value ? null : value;
      return { ...s, rating: next };
    });
    updateProject({ sequences: seqs });
  };

  const editingSeq = project.sequences.find((s) => s.id === editingId);

  const matchesFilter = (seq) => {
    const r = seq.rating || null;
    if (ratingFilter === 'all') return true;
    if (ratingFilter === 'none') return r == null;
    return r === ratingFilter;
  };
  const hasOutputs = (seq) => seq.messages.some((m) => outputs[m.id]);
  const visibleSequences = project.sequences.filter((s) => matchesFilter(s) && hasOutputs(s));

  const ratingCounts = project.sequences.reduce(
    (acc, s) => {
      const r = s.rating || 'none';
      acc[r] = (acc[r] || 0) + 1;
      return acc;
    },
    { up: 0, mid: 0, down: 0, none: 0 }
  );

  // Find max message count across visible sequences
  const maxMessages = Math.max(...visibleSequences.map((s) => s.messages.length), 0);

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
        {selectedIds.size > 0 && (
          <div className="seq-bulk-bar">
            <span className="seq-bulk-count">
              {selectedIds.size} selected
            </span>
            <div className="seq-bulk-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={clearSelection}
                disabled={bulkRegenerating}
              >
                Clear selection
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleBulkRegenerate}
                disabled={bulkRegenerating || confirmingBulkDelete}
                title="Regenerate outputs for the selected sequences"
              >
                {bulkRegenerating ? (
                  <>
                    <span className="spinner spinner-sm"></span>
                    <span style={{ marginLeft: 6 }}>Regenerating…</span>
                  </>
                ) : (
                  'Regenerate selected'
                )}
              </button>
              {confirmingBulkDelete ? (
                <>
                  <span className="text-secondary text-sm">
                    Delete {selectedIds.size} sequence{selectedIds.size === 1 ? '' : 's'}?
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setConfirmingBulkDelete(false)}
                  >
                    Cancel
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>
                    Confirm delete
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirmingBulkDelete(true)}
                  disabled={bulkRegenerating}
                >
                  Delete selected
                </button>
              )}
            </div>
          </div>
        )}
        <div className="seq-rating-filter">
          <span className="seq-rating-filter-label">Filter</span>
          {[
            { key: 'all',  label: 'All',     count: project.sequences.length },
            { key: 'up',   label: 'Up',      count: ratingCounts.up,   tone: 'up' },
            { key: 'mid',  label: 'Maybe',   count: ratingCounts.mid,  tone: 'mid' },
            { key: 'down', label: 'Down',    count: ratingCounts.down, tone: 'down' },
            { key: 'none', label: 'Unrated', count: ratingCounts.none },
          ].map((opt) => (
            <button
              key={opt.key}
              className={`seq-rating-pill${ratingFilter === opt.key ? ' active' : ''}${opt.tone ? ' seq-rating-pill-' + opt.tone : ''}`}
              onClick={() => setRatingFilter(opt.key)}
              type="button"
            >
              {opt.tone === 'up' && <ThumbUpIcon />}
              {opt.tone === 'mid' && <ThumbMidIcon />}
              {opt.tone === 'down' && <ThumbDownIcon />}
              <span>{opt.label}</span>
              <span className="seq-rating-pill-count">{opt.count}</span>
            </button>
          ))}
        </div>
        {visibleSequences.length === 0 ? (
          <div className="empty-state">
            <h3>No sequences match this filter</h3>
            <p>Choose a different rating filter to see sequences.</p>
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
              gridTemplateColumns: `100px repeat(${visibleSequences.length}, 450px)`,
              gridTemplateRows: `auto repeat(${maxMessages}, auto)`,
            }}
          >
            {/* Header row */}
            {(() => {
              const visibleIds = visibleSequences.map((s) => s.id);
              const visibleSelectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;
              const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
              const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
              return (
                <div className="seq-corner-header">
                  <input
                    type="checkbox"
                    className="seq-col-checkbox"
                    title={allVisibleSelected ? 'Deselect all (visible)' : 'Select all (visible)'}
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={toggleSelectAll}
                  />
                </div>
              );
            })()}
            {visibleSequences.map((seq) => {
              const hasDesc = !!(seq.description && seq.description.trim());
              const isSelected = selectedIds.has(seq.id);
              const rating = seq.rating || null;
              return (
              <div
                key={seq.id}
                className={`seq-col-header seq-col-header-stacked${isSelected ? ' seq-col-selected' : ''}${rating ? ' seq-col-rated seq-col-rated-' + rating : ''}`}
              >
                <div className="seq-col-header-row">
                  <span className="seq-col-name">{seq.name}</span>
                  <div className="seq-col-actions">
                    <div className="seq-thumbs" role="group" aria-label="Rate sequence">
                      <button
                        className={`seq-thumb seq-thumb-up${rating === 'up' ? ' active' : ''}`}
                        title="Mark as wanted"
                        onClick={() => handleRate(seq.id, 'up')}
                        type="button"
                      >
                        <ThumbUpIcon />
                      </button>
                      <button
                        className={`seq-thumb seq-thumb-mid${rating === 'mid' ? ' active' : ''}`}
                        title="Mark as maybe"
                        onClick={() => handleRate(seq.id, 'mid')}
                        type="button"
                      >
                        <ThumbMidIcon />
                      </button>
                      <button
                        className={`seq-thumb seq-thumb-down${rating === 'down' ? ' active' : ''}`}
                        title="Mark as not wanted"
                        onClick={() => handleRate(seq.id, 'down')}
                        type="button"
                      >
                        <ThumbDownIcon />
                      </button>
                    </div>
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
                    <input
                      type="checkbox"
                      className="seq-col-checkbox"
                      title={isSelected ? 'Deselect sequence' : 'Select sequence'}
                      checked={isSelected}
                      onChange={() => toggleSelect(seq.id)}
                    />
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
                {visibleSequences.map((seq) => {
                  const msg = seq.messages[rowIdx];
                  const ratingClass = seq.rating ? ` seq-cell-rated seq-cell-rated-${seq.rating}` : '';
                  if (!msg) return <div key={`${seq.id}-empty-${rowIdx}`} className={`seq-cell seq-cell-empty${ratingClass}`}>—</div>;
                  const output = outputs[msg.id];
                  return (
                    <div
                      key={msg.id}
                      className={`seq-cell ${output ? 'seq-cell-filled' : ''}${ratingClass}`}
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
                    {visibleSequences.map((seq) => {
                      const nextMsg = seq.messages[rowIdx + 1];
                      const ratingClass = seq.rating ? ` seq-cell-rated seq-cell-rated-${seq.rating}` : '';
                      if (!nextMsg) return <div key={`${seq.id}-delay-empty-${rowIdx}`} className={`seq-delay-cell${ratingClass}`}>—</div>;
                      return (
                        <div key={`${seq.id}-delay-${rowIdx}`} className={`seq-delay-cell${ratingClass}`}>
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
          <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
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
            <div className="prompt-view-grid">
              {promptModal.output && (
                <div className="prompt-view-col">
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
              <div className="prompt-view-col">
                <div className="form-label" style={{ marginBottom: 8 }}>Message Template</div>
                <HighlightedTextarea
                  rows={14}
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                />
              </div>
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
