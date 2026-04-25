import { useEffect, useRef, useState } from 'react';
import { buildVarMap, generateMessage } from '../utils/ai';
import { simulatePersonaReply, runWorkflow, RESPONSE_TYPES } from '../utils/sdr';
import { getApiKey, getSdrWorkflow, getSdrWorkflows, getProject } from '../utils/storage';
import { useToast } from './Toast';

// One (persona × sequence) chat transcript. All turns live on
// project.conversations[`${personaId}__${sequenceId}`] so they sync to the
// shared backend and survive reloads. The modal mutates that map in place
// via the updateProject callback.
export default function SimulateChatModal({
  project,
  updateProject,
  customerName,
  persona,
  sequence,
  onClose,
}) {
  const toast = useToast();
  const convKey = `${persona.id}__${sequence.id}`;
  const existing = project.conversations?.[convKey] || null;

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle'); // 'sdr' | 'persona' | 'idle'
  const [layerStatus, setLayerStatus] = useState(null); // { label } while a layer is running
  const [expandedDetails, setExpandedDetails] = useState({}); // { [turnId]: true }
  const scrollRef = useRef(null);
  const seededRef = useRef(false);
  // Speculative pre-run of the SDR workflow. Populated as soon as the lead's
  // reply is generated so that clicking "Respond" can reuse the in-flight
  // (or already-resolved) promise instead of waiting for a cold workflow run.
  // Shape: { key, afterTurnCount, workflowId, promise } | null
  const prefetchRef = useRef(null);

  const toggleDetails = (turnId) => setExpandedDetails((m) => ({ ...m, [turnId]: !m[turnId] }));

  const turns = existing?.turns || [];
  const workflowIdUsed = existing?.workflowIdUsed || project.sdrWorkflowId || null;
  const workflow = workflowIdUsed ? getSdrWorkflow(workflowIdUsed) : null;

  // Helper: push one or more turns (mutating the project's conversations map).
  // Each appended entry can carry extra metadata (functionCall, functionParameters,
  // layers) which is displayed as a small badge next to the bubble.
  //
  // IMPORTANT: read the freshest conversations map from storage on every call,
  // not from the `project` closure. Two rapid pushes inside the same effect
  // would otherwise both see the pre-push state and the second would clobber
  // the first.
  const pushTurns = (appended, workflowOverrideId) => {
    const nowIso = new Date().toISOString();
    const latest = getProject(project.id) || project;
    const priorMap = latest.conversations || {};
    const prior = priorMap[convKey] || {
      personaId: persona.id,
      sequenceId: sequence.id,
      workflowIdUsed: workflowOverrideId || workflowIdUsed || latest.sdrWorkflowId || null,
      turns: [],
      createdAt: nowIso,
    };
    const next = {
      ...prior,
      workflowIdUsed: workflowOverrideId || prior.workflowIdUsed,
      turns: [
        ...prior.turns,
        ...appended.map((t) => ({
          id: crypto.randomUUID(),
          role: t.role,
          text: t.text,
          createdAt: new Date().toISOString(),
          ...(t.suppressed ? { suppressed: true } : {}),
          ...(t.functionCall ? { functionCall: t.functionCall } : {}),
          ...(t.functionParameters ? { functionParameters: t.functionParameters } : {}),
          ...(Array.isArray(t.layers) && t.layers.length > 0 ? { layers: t.layers } : {}),
        })),
      ],
    };
    updateProject({
      conversations: { ...priorMap, [convKey]: next },
    });
  };

  // Seed: on first open of a fresh conversation, auto-generate the SDR opener
  // only. The user then picks how the lead replies via the flavour pills.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (existing && existing.turns && existing.turns.length > 0) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error('Set your Anthropic API key in Settings first');
      return;
    }
    const firstMsg = (sequence.messages || [])[0];
    if (!firstMsg) {
      toast.error('This sequence has no Message 1 to start from');
      return;
    }
    (async () => {
      setBusy(true);
      try {
        setPhase('sdr');
        const varMap = buildVarMap(
          {
            firstName: persona.firstName, lastName: persona.lastName,
            position: persona.position, company: persona.company,
            companyWebsite: persona.companyWebsite,
            companyDescription: persona.companyDescription,
            companyIndustry: persona.companyIndustry,
            companySize: persona.companySize,
            companyLocation: persona.companyLocation,
            location: persona.location,
          },
          project
        );
        const lang = project.language || 'en';
        const opener = await generateMessage(firstMsg, varMap, apiKey, lang);
        pushTurns([{ role: 'sdr', text: opener }], project.sdrWorkflowId);
      } catch (err) {
        toast.error('Seeding failed: ' + err.message);
      } finally {
        setPhase('idle');
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom when turns grow.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns.length]);

  // Kick off the SDR workflow in the background using the just-updated
  // transcript. Result is stashed on prefetchRef so handleRespond can reuse
  // it. We deliberately do NOT thread onProgress here — layer status is only
  // meaningful while the spinner is on screen.
  const startSdrPrefetch = (nextTurns) => {
    const anthropicKey = getApiKey('anthropic');
    if (!anthropicKey) return;
    const wf = workflow
      || getSdrWorkflow(project.sdrWorkflowId)
      || getSdrWorkflows()[0];
    if (!wf) return;
    const lang = project.language || 'en';
    const promise = runWorkflow({
      workflow: wf,
      persona,
      project,
      turns: nextTurns,
      customerName,
      lang,
    });
    // Swallow rejections at the source so an unconsumed prefetch error
    // doesn't surface as an unhandled promise rejection. handleRespond
    // re-checks via .then/.catch when consuming the cache.
    promise.catch(() => {});
    prefetchRef.current = {
      key: convKey,
      afterTurnCount: nextTurns.length,
      workflowId: wf.id,
      promise,
    };
  };

  // Fires the SDR workflow ONLY. The lead's reply is a separate explicit step
  // driven by the flavour pills below.
  const handleRespond = async () => {
    const anthropicKey = getApiKey('anthropic');
    if (!anthropicKey) { toast.error('Set your Anthropic API key in Settings → AI Providers first'); return; }
    const wf = workflow
      || getSdrWorkflow(project.sdrWorkflowId)
      || getSdrWorkflows()[0];
    if (!wf) { toast.error('No SDR workflow exists — add one in Settings → AI SDR Workflows'); return; }
    if (busy) return;
    setBusy(true);
    try {
      setPhase('sdr');
      const lang = project.language || 'en';
      const cached = prefetchRef.current;
      const usable = cached
        && cached.key === convKey
        && cached.afterTurnCount === turns.length
        && cached.workflowId === wf.id;
      let result;
      if (usable) {
        try {
          result = await cached.promise;
        } catch {
          // Prefetch rejected — fall back to a fresh call so the user gets
          // a normal error path rather than a stale background error.
          result = null;
        }
      }
      if (!result) {
        result = await runWorkflow({
          workflow: wf,
          persona,
          project,
          turns,
          customerName,
          lang,
          onProgress: ({ index, label, status }) => {
            if (status === 'running') setLayerStatus({ label: `Layer ${index + 1}: ${label}…` });
            else setLayerStatus(null);
          },
        });
      }
      setLayerStatus(null);
      // Suppressed = the workflow returned send_message_now=false OR had no
      // usable final_output. Instead of an SDR bubble with "None" (or a raw
      // JSON dump), render a compact centred note showing the decision.
      const sdrTurn = {
        role: 'sdr',
        text: result.final || '',
        ...(result.suppressed ? { suppressed: true } : {}),
        ...(result.functionCall ? { functionCall: result.functionCall } : {}),
        ...(result.functionParameters ? { functionParameters: result.functionParameters } : {}),
        ...(Array.isArray(result.layers) && result.layers.length > 0 ? { layers: result.layers } : {}),
      };
      pushTurns([sdrTurn], wf.id);
    } catch (err) {
      toast.error('Response failed: ' + err.message);
    } finally {
      prefetchRef.current = null;
      setPhase('idle');
      setLayerStatus(null);
      setBusy(false);
    }
  };

  // Fires ONLY the lead's reply, steered by the chosen response type.
  const handleProspectReply = async (responseType) => {
    const anthropicKey = getApiKey('anthropic');
    if (!anthropicKey) { toast.error('Set your Anthropic API key in Settings → AI Providers first'); return; }
    if (busy) return;
    // Drop any leftover prefetch from a previous turn before kicking off a
    // new lead reply. (Defence in depth — afterTurnCount also guards this.)
    prefetchRef.current = null;
    setBusy(true);
    try {
      setPhase('persona');
      const lang = project.language || 'en';
      const personaReply = await simulatePersonaReply(persona, project, turns, anthropicKey, lang, responseType);
      pushTurns([{ role: 'persona', text: personaReply }]);
      // Speculatively run the SDR workflow now so "Respond" feels instant.
      const nextTurns = [...turns, { role: 'persona', text: personaReply }];
      startSdrPrefetch(nextTurns);
    } catch (err) {
      toast.error('Lead reply failed: ' + err.message);
    } finally {
      setPhase('idle');
      setBusy(false);
    }
  };

  const handleClear = () => {
    if (!window.confirm('Clear this conversation and start over?')) return;
    const next = { ...(project.conversations || {}) };
    delete next[convKey];
    updateProject({ conversations: next });
    seededRef.current = false;
    prefetchRef.current = null;
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
        <div className="modal-header">
          <div>
            <h2 style={{ marginBottom: 4 }}>
              {persona.firstName} {persona.lastName} — {sequence.name}
            </h2>
            <div className="text-secondary text-sm">
              {persona.position} at {persona.company}
              {workflow ? ` · Workflow: ${workflow.name}` : ''}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>&times;</button>
        </div>

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 4px',
            borderTop: '1px solid var(--border)',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.15)',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {turns.length === 0 && !busy && (
            <div className="text-secondary" style={{ padding: 20, textAlign: 'center' }}>
              No messages yet.
            </div>
          )}
          {turns.map((t) => {
            const isSdr = t.role === 'sdr';
            const hasLayers = Array.isArray(t.layers) && t.layers.length > 0;
            const showDetails = hasLayers && !!expandedDetails[t.id];

            const detailsBlock = hasLayers ? (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => toggleDetails(t.id)}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11, padding: '4px 8px' }}
                >
                  {showDetails ? 'Hide JSON output' : 'Show JSON output'}
                </button>
                {showDetails && (
                  <div
                    style={{
                      marginTop: 6,
                      width: '100%',
                      padding: 10,
                      borderRadius: 6,
                      background: 'rgba(0,0,0,0.35)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      fontFamily: 'ui-monospace, Space Mono, monospace',
                      fontSize: 11,
                      lineHeight: 1.45,
                      textAlign: 'left',
                      color: 'var(--text-secondary)',
                      maxHeight: 360,
                      overflowY: 'auto',
                    }}
                  >
                    {t.layers.map((layer, idx) => (
                      <div key={layer.layerId || idx} style={{ marginBottom: idx < t.layers.length - 1 ? 12 : 0 }}>
                        <div style={{ color: 'var(--accent, #6366f1)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                          Layer {idx + 1} · {layer.label || '(unnamed)'}
                        </div>
                        <div style={{ marginBottom: 6, fontSize: 10, color: 'var(--text-secondary)' }}>Reasoning + raw response</div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#e2e8f0' }}>
                          {layer.text || '(empty)'}
                        </pre>
                        {layer.json != null && (
                          <>
                            <div style={{ margin: '8px 0 4px', fontSize: 10, color: 'var(--text-secondary)' }}>Parsed JSON</div>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#e2e8f0' }}>
                              {JSON.stringify(layer.json, null, 2)}
                            </pre>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null;

            // Suppressed SDR turns render as a centred muted system note,
            // not as an indigo SDR bubble, because no outgoing message
            // actually exists — the workflow only produced metadata.
            if (isSdr && t.suppressed) {
              return (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '8px 10px',
                  }}
                >
                  <div
                    style={{
                      maxWidth: '90%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px dashed rgba(255, 255, 255, 0.15)',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      fontStyle: 'italic',
                      textAlign: 'center',
                      lineHeight: 1.4,
                    }}
                  >
                    AI SDR chose not to send a message
                    {t.functionCall && (
                      <>
                        {' — '}
                        <span style={{ fontFamily: 'ui-monospace, Space Mono, monospace', fontStyle: 'normal' }}>
                          {t.functionCall}
                          {t.functionParameters ? `(${String(t.functionParameters)})` : ''}
                        </span>
                      </>
                    )}
                  </div>
                  {detailsBlock && <div style={{ width: '90%', maxWidth: '90%' }}>{detailsBlock}</div>}
                </div>
              );
            }
            return (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: isSdr ? 'flex-end' : 'flex-start',
                  padding: '6px 10px',
                }}
              >
                <div
                  style={{
                    maxWidth: '78%',
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: isSdr
                      ? 'rgba(99, 102, 241, 0.18)'
                      : 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid ' + (isSdr ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.08)'),
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.45,
                    fontSize: 13,
                  }}
                >
                  <div className="text-secondary text-sm" style={{ marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {isSdr
                      ? 'AI SDR'
                      : (`${persona.firstName || ''} ${persona.lastName || ''}`.trim() || 'Lead')}
                  </div>
                  {t.text}
                  {t.functionCall && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className="badge badge-delay" style={{ fontSize: 10 }}>
                        → {t.functionCall}{t.functionParameters ? `: ${String(t.functionParameters)}` : ''}
                      </span>
                    </div>
                  )}
                  {detailsBlock}
                </div>
              </div>
            );
          })}
          {busy && (
            <div style={{ padding: '6px 14px', color: 'var(--text-secondary)', fontSize: 12 }}>
              <span className="spinner spinner-sm"></span>{' '}
              {layerStatus ? layerStatus.label : (phase === 'sdr' ? 'AI SDR is typing…' : 'Prospect is typing…')}
            </div>
          )}
        </div>

        {(() => {
          const lastRole = turns.length > 0 ? turns[turns.length - 1].role : null;
          // Whose turn is it to reply?
          //   last turn was SDR (or no turns at all) → lead should reply → show pills
          //   last turn was lead → SDR should reply → show Respond button
          const nextIsLead = lastRole === 'sdr' || lastRole === null;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0' }}>
              <span
                className="text-secondary"
                style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}
              >
                {nextIsLead ? 'Lead replies as:' : 'SDR responds:'}
              </span>
              {nextIsLead
                ? RESPONSE_TYPES.map((rt) => (
                    <button
                      key={rt.id}
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleProspectReply(rt.id)}
                      disabled={busy || turns.length === 0}
                      title={`Generate the lead's next reply in the "${rt.label}" style`}
                    >
                      {rt.label}
                    </button>
                  ))
                : (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleRespond}
                    disabled={busy}
                  >
                    {busy ? <><span className="spinner spinner-sm"></span> Responding…</> : 'Respond'}
                  </button>
                )
              }
            </div>
          );
        })()}

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn btn-ghost btn-sm" onClick={handleClear} disabled={busy}>
            Clear transcript
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
