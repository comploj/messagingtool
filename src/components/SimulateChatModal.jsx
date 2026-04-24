import { useEffect, useRef, useState } from 'react';
import { buildVarMap, generateMessage } from '../utils/ai';
import { simulatePersonaReply, runWorkflow } from '../utils/sdr';
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
  const scrollRef = useRef(null);
  const seededRef = useRef(false);

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
          ...(t.functionCall ? { functionCall: t.functionCall } : {}),
          ...(t.functionParameters ? { functionParameters: t.functionParameters } : {}),
        })),
      ],
    };
    updateProject({
      conversations: { ...priorMap, [convKey]: next },
    });
  };

  // Seed: on first open of a fresh conversation, auto-generate the SDR
  // opening (from the sequence's first message) + one persona reply.
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
        await new Promise((r) => setTimeout(r, 800));
        setPhase('persona');
        const reply = await simulatePersonaReply(persona, project, [{ role: 'sdr', text: opener }], apiKey, lang);
        pushTurns([{ role: 'persona', text: reply }]);
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

  const handleRespond = async () => {
    const anthropicKey = getApiKey('anthropic');
    if (!anthropicKey) { toast.error('Set your Anthropic API key in Settings → AI Providers first'); return; }
    // Fallback chain: workflow the chat was started with → the project's current
    // choice → the first workflow that exists. So a fresh project that never
    // opened Settings still works out of the box.
    const wf = workflow
      || getSdrWorkflow(project.sdrWorkflowId)
      || getSdrWorkflows()[0];
    if (!wf) { toast.error('No SDR workflow exists — add one in Settings → AI SDR Workflows'); return; }
    if (busy) return;
    setBusy(true);
    try {
      setPhase('sdr');
      const lang = project.language || 'en';
      const result = await runWorkflow({
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
      setLayerStatus(null);
      const sdrTurn = {
        role: 'sdr',
        text: result.final,
        ...(result.functionCall ? { functionCall: result.functionCall } : {}),
        ...(result.functionParameters ? { functionParameters: result.functionParameters } : {}),
      };
      pushTurns([sdrTurn], wf.id);
      const updatedTurns = [...turns, { role: 'sdr', text: result.final }];
      if (result.sendMessageNow === false) {
        toast.info?.('Workflow set send_message_now=false — no prospect reply generated.');
      } else {
        await new Promise((r) => setTimeout(r, 800));
        setPhase('persona');
        const personaReply = await simulatePersonaReply(persona, project, updatedTurns, anthropicKey, lang);
        pushTurns([{ role: 'persona', text: personaReply }]);
      }
    } catch (err) {
      toast.error('Response failed: ' + err.message);
    } finally {
      setPhase('idle');
      setLayerStatus(null);
      setBusy(false);
    }
  };

  const handleClear = () => {
    if (!window.confirm('Clear this conversation and start over?')) return;
    const next = { ...(project.conversations || {}) };
    delete next[convKey];
    updateProject({ conversations: next });
    seededRef.current = false;
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
          {turns.map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                justifyContent: t.role === 'sdr' ? 'flex-end' : 'flex-start',
                padding: '6px 10px',
              }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: t.role === 'sdr'
                    ? 'rgba(99, 102, 241, 0.18)'
                    : 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid ' + (t.role === 'sdr' ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.08)'),
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.45,
                  fontSize: 13,
                }}
              >
                <div className="text-secondary text-sm" style={{ marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t.role === 'sdr'
                    ? (`${project.senderFirstName || ''} ${project.senderLastName || ''}`.trim() || 'AI SDR')
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
              </div>
            </div>
          ))}
          {busy && (
            <div style={{ padding: '6px 14px', color: 'var(--text-secondary)', fontSize: 12 }}>
              <span className="spinner spinner-sm"></span>{' '}
              {layerStatus ? layerStatus.label : (phase === 'sdr' ? 'AI SDR is typing…' : 'Prospect is typing…')}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn btn-ghost btn-sm" onClick={handleClear} disabled={busy}>
            Clear transcript
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={handleRespond} disabled={busy || turns.length === 0}>
              {busy ? <><span className="spinner spinner-sm"></span> Responding…</> : 'Respond'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
