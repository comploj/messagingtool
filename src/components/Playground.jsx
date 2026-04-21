import { useState, useEffect, useCallback } from 'react';
import { getApiKey } from '../utils/storage';
import { scrapeCompanyInfo, buildVarMap, generateMessage } from '../utils/ai';
import { useToast } from './Toast';
import MessageRow from './MessageRow';

const emptyLead = {
  firstName: '',
  lastName: '',
  position: '',
  company: '',
  companyWebsite: '',
  companyDescription: '',
  companyIndustry: '',
  companySize: '',
  companyLocation: '',
  location: '',
};

const LEAD_STORAGE_KEY = (projectId) => `leadhunt_lead_${projectId}`;
const OUTPUTS_STORAGE_KEY = (projectId) => `leadhunt_outputs_${projectId}`;
const SEQ_STORAGE_KEY = (projectId) => `leadhunt_selected_seq_${projectId}`;

function loadLead(projectId) {
  try {
    return JSON.parse(localStorage.getItem(LEAD_STORAGE_KEY(projectId))) || emptyLead;
  } catch { return emptyLead; }
}

function loadOutputs(projectId) {
  try {
    return JSON.parse(localStorage.getItem(OUTPUTS_STORAGE_KEY(projectId))) || {};
  } catch { return {}; }
}

export default function Playground({ project }) {
  const [lead, setLead] = useState(() => loadLead(project.id));
  const [selectedSeqId, setSelectedSeqId] = useState(
    () => localStorage.getItem(SEQ_STORAGE_KEY(project.id)) || project.sequences[0]?.id || ''
  );
  const [outputs, setOutputs] = useState(() => loadOutputs(project.id));
  const [loadingIds, setLoadingIds] = useState(new Set());
  const [scraping, setScraping] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const toast = useToast();

  const selectedSeq = project.sequences.find((s) => s.id === selectedSeqId);

  // Persist lead, outputs, and selected sequence to localStorage
  useEffect(() => {
    localStorage.setItem(LEAD_STORAGE_KEY(project.id), JSON.stringify(lead));
  }, [lead, project.id]);

  useEffect(() => {
    localStorage.setItem(OUTPUTS_STORAGE_KEY(project.id), JSON.stringify(outputs));
  }, [outputs, project.id]);

  useEffect(() => {
    localStorage.setItem(SEQ_STORAGE_KEY(project.id), selectedSeqId);
  }, [selectedSeqId, project.id]);

  const updateLead = (field, value) => {
    setLead((prev) => ({ ...prev, [field]: value }));
  };

  const handleScrapeCompany = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error('Set your Anthropic API key in Settings first');
      return;
    }
    if (!lead.companyWebsite) {
      toast.error('Enter a company website URL first');
      return;
    }
    setScraping(true);
    try {
      const info = await scrapeCompanyInfo(lead.companyWebsite, apiKey);
      setLead((prev) => ({
        ...prev,
        company: info.companyName || prev.company,
        companyDescription: info.companyDescription || '',
        companyIndustry: info.industry || '',
        companySize: info.size || '',
        companyLocation: info.location || '',
      }));
      toast.success('Company info extracted');
    } catch (err) {
      toast.error('Scrape failed: ' + err.message);
    } finally {
      setScraping(false);
    }
  };

  const handleGenerate = async (message) => {
    const apiKey = getApiKey();
    if (!apiKey && message.type === 'ai') {
      toast.error('Set your Anthropic API key in Settings first');
      return;
    }
    const varMap = buildVarMap(lead, project);
    setLoadingIds((prev) => new Set(prev).add(message.id));
    try {
      const result = await generateMessage(message, varMap, apiKey, project?.language || 'en');
      setOutputs((prev) => ({ ...prev, [message.id]: result }));
    } catch (err) {
      toast.error('Generation failed: ' + err.message);
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  };

  const handleGenerateAll = async () => {
    if (!selectedSeq) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error('Set your Anthropic API key in Settings first');
      return;
    }
    setGeneratingAll(true);
    for (const msg of selectedSeq.messages) {
      const varMap = buildVarMap(lead, project);
      setLoadingIds((prev) => new Set(prev).add(msg.id));
      try {
        const result = await generateMessage(msg, varMap, apiKey, project?.language || 'en');
        setOutputs((prev) => ({ ...prev, [msg.id]: result }));
      } catch (err) {
        toast.error(`Failed on ${msg.label}: ${err.message}`);
      } finally {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });
      }
      // 800ms delay between calls to respect rate limits
      await new Promise((r) => setTimeout(r, 800));
    }
    setGeneratingAll(false);
    toast.success('All messages generated');
  };

  return (
    <div className="playground">
      <div className="playground-panel">
        <h3>Lead Information</h3>
        <div className="lead-form">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">First Name</label>
              <input className="input" value={lead.firstName} onChange={(e) => updateLead('firstName', e.target.value)} placeholder="Jane" />
            </div>
            <div className="form-group">
              <label className="form-label">Last Name</label>
              <input className="input" value={lead.lastName} onChange={(e) => updateLead('lastName', e.target.value)} placeholder="Smith" />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Position</label>
            <input className="input" value={lead.position} onChange={(e) => updateLead('position', e.target.value)} placeholder="VP of Marketing" />
          </div>

          <div className="form-group">
            <label className="form-label">Company</label>
            <input className="input" value={lead.company} onChange={(e) => updateLead('company', e.target.value)} placeholder="TechCorp" />
          </div>

          <div className="scrape-row">
            <div className="form-group">
              <label className="form-label">Company Website</label>
              <input className="input" value={lead.companyWebsite} onChange={(e) => updateLead('companyWebsite', e.target.value)} placeholder="https://techcorp.com" />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleScrapeCompany} disabled={scraping}>
              {scraping ? <><span className="spinner spinner-sm"></span></> : 'Scrape'}
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Company Description</label>
            <textarea className="textarea" rows={2} value={lead.companyDescription} onChange={(e) => updateLead('companyDescription', e.target.value)} placeholder="Extracted from website..." />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Industry</label>
              <input className="input" value={lead.companyIndustry} onChange={(e) => updateLead('companyIndustry', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Company Size</label>
              <input className="input" value={lead.companySize} onChange={(e) => updateLead('companySize', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Company Location</label>
              <input className="input" value={lead.companyLocation} onChange={(e) => updateLead('companyLocation', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Person Location</label>
              <input className="input" value={lead.location} onChange={(e) => updateLead('location', e.target.value)} />
            </div>
          </div>

          <div className="generate-bar">
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Sequence</label>
              <select value={selectedSeqId} onChange={(e) => setSelectedSeqId(e.target.value)}>
                {project.sequences.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleGenerateAll}
            disabled={generatingAll || !selectedSeq}
            style={{ width: '100%' }}
          >
            {generatingAll ? (
              <><span className="spinner spinner-sm"></span> Generating...</>
            ) : (
              'Generate All'
            )}
          </button>
        </div>
      </div>

      <div>
        <h3 style={{ marginBottom: 12 }}>
          Message Preview
          {selectedSeq && <span className="text-secondary text-sm"> — {selectedSeq.name}</span>}
        </h3>
        {selectedSeq ? (
          <div className="message-rows">
            {selectedSeq.messages.map((msg) => (
              <MessageRow
                key={msg.id}
                message={msg}
                output={outputs[msg.id] || ''}
                loading={loadingIds.has(msg.id)}
                onGenerate={() => handleGenerate(msg)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>Select a sequence to preview messages</p>
          </div>
        )}
      </div>
    </div>
  );
}
