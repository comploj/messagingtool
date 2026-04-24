import { useEffect, useState } from 'react';
import { generatePersonas } from '../utils/sdr';
import { composeValueProposition } from '../utils/ai';
import { getApiKey, getSdrWorkflows, getCustomer } from '../utils/storage';
import { useToast } from './Toast';
import SimulateChatModal from './SimulateChatModal';

const PERSONA_COUNT = 5;

export default function AiSdrPlayground({ project, updateProject }) {
  const toast = useToast();
  const [populating, setPopulating] = useState(false);
  const [chat, setChat] = useState(null); // { persona, sequence }

  const workflows = getSdrWorkflows();
  const activeWorkflowId = project.sdrWorkflowId || workflows[0]?.id || null;

  // If the project doesn't have a workflow yet but workflows exist,
  // persist the default choice so the chat modal has something to run.
  useEffect(() => {
    if (!project.sdrWorkflowId && workflows[0]?.id) {
      updateProject({ sdrWorkflowId: workflows[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  const customer = project.customerId ? getCustomer(project.customerId) : null;
  const customerName = customer?.name || project.clientName || '';
  const personas = Array.isArray(project.personas) ? project.personas : [];
  const conversations = project.conversations || {};

  const anyChats = Object.keys(conversations).length > 0;

  const handlePopulate = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { toast.error('Set your Anthropic API key in Settings first'); return; }
    const vp = composeValueProposition(project.valueProposition);
    if (!vp) {
      toast.error('Fill in the value proposition on the Overview tab first');
      return;
    }
    if (personas.length > 0 && anyChats) {
      if (!window.confirm('Populate 5 fresh ICPs? This wipes the existing personas and their conversations.')) return;
    }
    setPopulating(true);
    try {
      const next = await generatePersonas(vp, customerName, PERSONA_COUNT, project.language || 'en', apiKey);
      updateProject({ personas: next, conversations: {} });
      toast.success(`Generated ${next.length} personas`);
    } catch (err) {
      toast.error('Populate failed: ' + err.message);
    } finally {
      setPopulating(false);
    }
  };

  const handlePickWorkflow = (id) => {
    updateProject({ sdrWorkflowId: id });
  };

  const handleDeleteChat = (e, key) => {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation transcript?')) return;
    const next = { ...conversations };
    delete next[key];
    updateProject({ conversations: next });
  };

  return (
    <>
      <div
        className="overview-section"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <button
          className="btn btn-primary"
          onClick={handlePopulate}
          disabled={populating}
        >
          {populating
            ? <><span className="spinner spinner-sm"></span> Populating 5 ICPs…</>
            : (personas.length > 0 ? 'Repopulate 5 ICPs' : 'Populate 5 ICPs')}
        </button>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" style={{ marginRight: 8 }}>WORKFLOW</label>
          <select
            className="input"
            style={{ minWidth: 220, padding: '8px 10px' }}
            value={activeWorkflowId || ''}
            onChange={(e) => handlePickWorkflow(e.target.value)}
            disabled={workflows.length === 0}
          >
            {workflows.length === 0 && <option value="">No workflows (add one in Settings)</option>}
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <span className="text-secondary text-sm" style={{ marginLeft: 'auto' }}>
          Test how the AI SDR carries a conversation with someone in your ICP.
        </span>
      </div>

      {personas.length === 0 ? (
        <div className="empty-state">
          <h3>No personas yet</h3>
          <p>Populate five fictitious people that match this project's ICP and then simulate a conversation for any sequence.</p>
        </div>
      ) : (
        <div className="project-grid">
          {personas.map((p) => (
            <div key={p.id} className="project-card" style={{ cursor: 'default' }}>
              <h3>{p.firstName} {p.lastName}</h3>
              <div className="text-secondary text-sm" style={{ marginBottom: 4 }}>
                {p.position}
              </div>
              <div className="text-secondary text-sm" style={{ marginBottom: 4 }}>
                <strong>{p.company}</strong>
                {p.companyIndustry ? ` · ${p.companyIndustry}` : ''}
              </div>
              <div className="text-secondary text-sm" style={{ marginBottom: 10 }}>
                {p.companyLocation || p.location || ''}
              </div>

              <div className="form-label" style={{ marginBottom: 6 }}>SEQUENCES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {(project.sequences || []).map((seq) => {
                  const key = `${p.id}__${seq.id}`;
                  const existing = conversations[key];
                  return (
                    <div
                      key={seq.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 8px',
                        border: '1px solid var(--border, rgba(255,255,255,0.08))',
                        borderRadius: 6,
                      }}
                    >
                      <span className="text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {seq.name}
                      </span>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setChat({ persona: p, sequence: seq })}
                        >
                          {existing ? 'Open chat' : 'Simulate'}
                        </button>
                        {existing && (
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Delete transcript"
                            onClick={(e) => handleDeleteChat(e, key)}
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(project.sequences || []).length === 0 && (
                  <div className="text-secondary text-sm">No sequences on this project.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {chat && (
        <SimulateChatModal
          project={project}
          updateProject={updateProject}
          customerName={customerName}
          persona={chat.persona}
          sequence={chat.sequence}
          onClose={() => setChat(null)}
        />
      )}
    </>
  );
}
