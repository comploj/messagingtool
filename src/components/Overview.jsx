import { useState, useEffect } from 'react';
import { getApiKey } from '../utils/storage';
import { scrapeValueProposition, scrapeCompanyInfo, buildVarMap, generateMessage, callClaude } from '../utils/ai';
import { useToast } from './Toast';

const emptyLead = {
  firstName: '', lastName: '', position: '', company: '',
  companyWebsite: '', companyDescription: '', companyIndustry: '',
  companySize: '', companyLocation: '', location: '',
};

const LEAD_KEY = (id) => `leadhunt_lead_${id}`;
const OUTPUTS_KEY = (id) => `leadhunt_outputs_${id}`;
const SELECTED_SEQS_KEY = (id) => `leadhunt_selected_seqs_${id}`;

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}

export default function Overview({ project, updateProject }) {
  const [scraping, setScraping] = useState(false);
  const [scrapingCompany, setScrapingCompany] = useState(false);
  const [lead, setLead] = useState(() => loadJson(LEAD_KEY(project.id), emptyLead));
  const [selectedSeqs, setSelectedSeqs] = useState(
    () => loadJson(SELECTED_SEQS_KEY(project.id), project.sequences.map((s) => s.id))
  );
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState('');
  const [pasteModal, setPasteModal] = useState(null); // 'vp' | 'company' | null
  const [pasteText, setPasteText] = useState('');
  const [pasteProcessing, setPasteProcessing] = useState(false);
  const toast = useToast();

  // Persist lead and selection
  useEffect(() => {
    localStorage.setItem(LEAD_KEY(project.id), JSON.stringify(lead));
  }, [lead, project.id]);

  useEffect(() => {
    localStorage.setItem(SELECTED_SEQS_KEY(project.id), JSON.stringify(selectedSeqs));
  }, [selectedSeqs, project.id]);

  const handleChange = (field, value) => {
    updateProject({ [field]: value });
  };

  const updateLead = (field, value) => {
    setLead((prev) => ({ ...prev, [field]: value }));
  };

  const handleScrapeVP = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { toast.error('Set your Anthropic API key in Settings first'); return; }
    if (!project.clientWebsite) { toast.error('Enter a website URL first'); return; }
    setScraping(true);
    try {
      const vp = await scrapeValueProposition(project.clientWebsite, apiKey);
      updateProject({ valueProposition: vp });
      toast.success('Value proposition extracted');
    } catch (err) {
      toast.error('Scrape failed: ' + err.message);
    } finally {
      setScraping(false);
    }
  };

  const handlePasteSubmit = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { toast.error('Set your Anthropic API key in Settings first'); return; }
    if (!pasteText.trim()) { toast.error('Paste some content first'); return; }
    setPasteProcessing(true);
    try {
      const text = pasteText.trim().slice(0, 6000);
      if (pasteModal === 'vp') {
        const prompt = `You are a business analyst. Given the following website text, write a clear and compelling 3-5 sentence value proposition paragraph. Describe what the company does, who they help, and what outcomes they deliver. Write in third person.\n\nWebsite text:\n${text}\n\nReturn ONLY the value proposition paragraph, no quotes, no markdown.`;
        const vp = await callClaude(prompt, apiKey);
        updateProject({ valueProposition: vp });
        toast.success('Value proposition extracted');
      } else {
        const prompt = `You are a data extraction assistant. Given the following website text, extract company information and return ONLY a valid JSON object with these fields:\n- "companyDescription": A 2-3 sentence description of what the company does\n- "industry": The company's industry\n- "size": Estimated company size (e.g. "10-50 employees", "Enterprise", "Startup") — use "Unknown" if not clear\n- "location": Company headquarters location — use "Unknown" if not clear\n- "targetCustomers": Who their target customers are\n- "keyProblems": What key problems they solve\n\nWebsite text:\n${text}\n\nReturn ONLY the JSON object, no markdown, no explanation.`;
        const response = await callClaude(prompt, apiKey);
        let info;
        try { info = JSON.parse(response); } catch {
          const match = response.match(/\{[\s\S]*\}/);
          if (match) info = JSON.parse(match[0]);
          else throw new Error('Failed to parse response');
        }
        setLead((prev) => ({
          ...prev,
          companyDescription: info.companyDescription || '',
          companyIndustry: info.industry || '',
          companySize: info.size || '',
          companyLocation: info.location || '',
        }));
        toast.success('Company info extracted');
      }
      setPasteModal(null);
      setPasteText('');
    } catch (err) {
      toast.error('Processing failed: ' + err.message);
    } finally {
      setPasteProcessing(false);
    }
  };

  const handleScrapeCompany = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { toast.error('Set your Anthropic API key in Settings first'); return; }
    if (!lead.companyWebsite) { toast.error('Enter a company website URL first'); return; }
    setScrapingCompany(true);
    try {
      const info = await scrapeCompanyInfo(lead.companyWebsite, apiKey);
      setLead((prev) => ({
        ...prev,
        companyDescription: info.companyDescription || '',
        companyIndustry: info.industry || '',
        companySize: info.size || '',
        companyLocation: info.location || '',
      }));
      toast.success('Company info extracted');
    } catch (err) {
      toast.error('Scrape failed: ' + err.message);
    } finally {
      setScrapingCompany(false);
    }
  };

  const toggleSeq = (id) => {
    setSelectedSeqs((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const allIds = project.sequences.map((s) => s.id);
    setSelectedSeqs(selectedSeqs.length === allIds.length ? [] : allIds);
  };

  const handleGenerate = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { toast.error('Set your Anthropic API key in Settings first'); return; }
    const seqs = project.sequences.filter((s) => selectedSeqs.includes(s.id));
    if (seqs.length === 0) { toast.error('Select at least one sequence'); return; }

    setGenerating(true);
    const outputs = loadJson(OUTPUTS_KEY(project.id), {});
    const varMap = buildVarMap(lead, project);
    let count = 0;
    const total = seqs.reduce((sum, s) => sum + s.messages.filter((m) => m.type === 'ai').length, 0)
      + seqs.reduce((sum, s) => sum + s.messages.filter((m) => m.type === 'static').length, 0);

    for (const seq of seqs) {
      for (const msg of seq.messages) {
        count++;
        setGenProgress(`${count}/${total} — ${seq.name}: ${msg.label}`);
        try {
          const result = await generateMessage(msg, varMap, apiKey);
          outputs[msg.id] = result;
          localStorage.setItem(OUTPUTS_KEY(project.id), JSON.stringify(outputs));
        } catch (err) {
          toast.error(`Failed: ${seq.name} > ${msg.label}: ${err.message}`);
        }
        if (msg.type === 'ai') {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }
    setGenerating(false);
    setGenProgress('');
    toast.success(`Generated messages for ${seqs.length} sequences`);
  };

  const allSelected = selectedSeqs.length === project.sequences.length;

  return (
    <>
      <div className="overview-grid">
        <div className="overview-section">
          <h3>Client Info</h3>
          <div className="form-group mb-16">
            <label className="form-label">Client Name</label>
            <input className="input" value={project.clientName} onChange={(e) => handleChange('clientName', e.target.value)} placeholder="Company name" />
          </div>
          <div className="form-group">
            <label className="form-label">Website URL</label>
            <input className="input" value={project.clientWebsite} onChange={(e) => handleChange('clientWebsite', e.target.value)} placeholder="https://example.com" />
          </div>
        </div>

        <div className="overview-section">
          <h3>Sender Info</h3>
          <div className="form-group mb-16">
            <label className="form-label">First Name</label>
            <input className="input" value={project.senderFirstName} onChange={(e) => handleChange('senderFirstName', e.target.value)} placeholder="John" />
          </div>
          <div className="form-group">
            <label className="form-label">Last Name</label>
            <input className="input" value={project.senderLastName} onChange={(e) => handleChange('senderLastName', e.target.value)} placeholder="Doe" />
          </div>
        </div>

        <div className="overview-section overview-full">
          <div className="vp-header">
            <h3>Value Proposition</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setPasteModal('vp'); setPasteText(''); }}>
                Paste content
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleScrapeVP} disabled={scraping}>
                {scraping ? <><span className="spinner spinner-sm"></span> Scraping...</> : 'Scrape from website'}
              </button>
            </div>
          </div>
          <textarea className="textarea" rows={4} value={project.valueProposition} onChange={(e) => handleChange('valueProposition', e.target.value)} placeholder="Describe what this company does, who they help, and what outcomes they deliver..." />
        </div>
      </div>

      <div className="overview-section overview-lead-section">
        <h3>Lead Information</h3>
        <div className="overview-grid" style={{ marginBottom: 0 }}>
          <div>
            <div className="form-row mb-16">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="input" value={lead.firstName} onChange={(e) => updateLead('firstName', e.target.value)} placeholder="Jane" />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="input" value={lead.lastName} onChange={(e) => updateLead('lastName', e.target.value)} placeholder="Smith" />
              </div>
            </div>
            <div className="form-group mb-16">
              <label className="form-label">Position</label>
              <input className="input" value={lead.position} onChange={(e) => updateLead('position', e.target.value)} placeholder="VP of Marketing" />
            </div>
            <div className="form-group mb-16">
              <label className="form-label">Company</label>
              <input className="input" value={lead.company} onChange={(e) => updateLead('company', e.target.value)} placeholder="TechCorp" />
            </div>
            <div className="scrape-row">
              <div className="form-group">
                <label className="form-label">Company Website</label>
                <input className="input" value={lead.companyWebsite} onChange={(e) => updateLead('companyWebsite', e.target.value)} placeholder="https://techcorp.com" />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { setPasteModal('company'); setPasteText(''); }}>
                Paste
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleScrapeCompany} disabled={scrapingCompany}>
                {scrapingCompany ? <span className="spinner spinner-sm"></span> : 'Scrape'}
              </button>
            </div>
          </div>
          <div>
            <div className="form-group mb-16">
              <label className="form-label">Company Description</label>
              <textarea className="textarea" rows={2} value={lead.companyDescription} onChange={(e) => updateLead('companyDescription', e.target.value)} placeholder="Extracted from website..." />
            </div>
            <div className="form-row mb-16">
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
          </div>
        </div>
      </div>

      <div className="overview-section overview-generate-section">
        <div className="vp-header">
          <h3>Generate Messages</h3>
          <label className="seq-toggle" onClick={toggleAll}>
            <input type="checkbox" checked={allSelected} readOnly />
            <span>{allSelected ? 'Deselect All' : 'Select All'}</span>
          </label>
        </div>
        <div className="seq-checkboxes">
          {project.sequences.map((seq) => (
            <label key={seq.id} className="seq-checkbox">
              <input
                type="checkbox"
                checked={selectedSeqs.includes(seq.id)}
                onChange={() => toggleSeq(seq.id)}
              />
              <span>{seq.name}</span>
            </label>
          ))}
        </div>
        <button
          className="btn btn-primary mt-16"
          onClick={handleGenerate}
          disabled={generating || selectedSeqs.length === 0}
          style={{ width: '100%' }}
        >
          {generating ? (
            <><span className="spinner spinner-sm"></span> {genProgress}</>
          ) : (
            `Generate Messages (${selectedSeqs.length} sequences)`
          )}
        </button>
      </div>

      {pasteModal && (
        <div className="modal-overlay" onClick={() => setPasteModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{pasteModal === 'vp' ? 'Paste Website Content' : 'Paste Company Content'}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setPasteModal(null)}>&times;</button>
            </div>
            <p className="text-secondary text-sm mb-16">
              Copy text from the website and paste it below. The AI will extract {pasteModal === 'vp' ? 'the value proposition' : 'company information'} from it.
            </p>
            <textarea
              className="textarea textarea-mono"
              rows={10}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste website text here..."
              autoFocus
            />
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPasteModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePasteSubmit} disabled={pasteProcessing || !pasteText.trim()}>
                {pasteProcessing ? <><span className="spinner spinner-sm"></span> Processing...</> : 'Extract'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
