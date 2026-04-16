import { useState, useEffect } from 'react';
import { getApiKey } from '../utils/storage';
import { scrapeValueProposition, extractVpFromText, scrapeCompanyInfo, buildVarMap, generateMessage, callClaude, generateICP, composeValueProposition } from '../utils/ai';
import { switchSequenceLanguage } from '../utils/defaults';
import { useToast } from './Toast';

const emptyLead = {
  firstName: '', lastName: '', position: '', company: '',
  companyWebsite: '', companyDescription: '', companyIndustry: '',
  companySize: '', companyLocation: '', location: '', anrede: '',
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
  const [generatingICP, setGeneratingICP] = useState(false);
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
      const vp = await scrapeValueProposition(project.clientWebsite, apiKey, lang);
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
        const vp = await extractVpFromText(text, apiKey, lang);
        updateProject({ valueProposition: vp });
        toast.success('Value proposition extracted');
      } else {
        const langInstr = lang === 'de' ? 'Write ALL field values in German.' : 'Write ALL field values in English.';
        const prompt = `You are a data extraction assistant. Given the following website text, extract company information and return ONLY a valid JSON object with these fields:\n- "companyDescription": A 2-3 sentence description of what the company does\n- "industry": The company's industry\n- "size": Estimated company size (e.g. "10-50 employees", "Enterprise", "Startup") — use "Unknown" if not clear\n- "location": Company headquarters location — use "Unknown" if not clear\n- "targetCustomers": Who their target customers are\n- "keyProblems": What key problems they solve\n\n${langInstr}\n\nWebsite text:\n${text}\n\nReturn ONLY the JSON object, no markdown, no explanation.`;
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
      const info = await scrapeCompanyInfo(lead.companyWebsite, apiKey, lang);
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

  const handleGenerateICP = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { toast.error('Set your Anthropic API key in Settings first'); return; }
    const vpStr = composeValueProposition(project.valueProposition);
    if (!vpStr) {
      toast.error('Fill in the value proposition first (scrape or type it manually)');
      return;
    }
    setGeneratingICP(true);
    try {
      const icp = await generateICP(vpStr, project.clientName, apiKey, lang);
      setLead(icp);
      toast.success('Ideal customer profile generated');
    } catch (err) {
      toast.error('ICP generation failed: ' + err.message);
    } finally {
      setGeneratingICP(false);
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

  const handleLanguageSwitch = (newLang) => {
    const switched = switchSequenceLanguage(project.sequences, newLang);
    updateProject({ sequences: switched, language: newLang });
    toast.success(`Prompts switched to ${newLang === 'de' ? 'German' : 'English'}`);
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

  const lang = project.language || 'en';

  return (
    <>
      <div className="overview-section overview-lang-section mb-16">
        <div className="vp-header">
          <h3>Message Language</h3>
          <div className="lang-toggle">
            <button
              className={`btn btn-sm ${lang === 'en' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => handleLanguageSwitch('en')}
            >
              English
            </button>
            <button
              className={`btn btn-sm ${lang === 'de' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => handleLanguageSwitch('de')}
            >
              Deutsch
            </button>
          </div>
        </div>
      </div>

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
          <div className="vp-grid">
            {[
              { key: 'summary', label: 'Summary', placeholder: '1-2 sentence company overview...', full: true },
              { key: 'elevatorPitch', label: 'Elevator Pitch', placeholder: 'We help [audience] to [outcome] by [method]...' },
              { key: 'painPoints', label: 'Pain Points', placeholder: 'Key problems the target audience faces...' },
              { key: 'usps', label: 'USPs', placeholder: 'What makes this company unique...' },
              { key: 'services', label: 'Services', placeholder: 'Core services and products offered...' },
              { key: 'benefits', label: 'Benefits', placeholder: 'Concrete outcomes and results clients get...' },
              { key: 'urgency', label: 'Urgency', placeholder: 'Why act now — market timing, cost of inaction...' },
            ].map(({ key, label, placeholder, full }) => {
              const vp = project.valueProposition || {};
              return (
                <div key={key} className={`form-group${full ? ' vp-grid-full' : ''}`}>
                  <label className="form-label">{label}</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={typeof vp === 'string' ? (key === 'summary' ? vp : '') : (vp[key] || '')}
                    onChange={(e) => {
                      const current = typeof project.valueProposition === 'string'
                        ? { summary: project.valueProposition, elevatorPitch: '', painPoints: '', usps: '', urgency: '', services: '', benefits: '' }
                        : (project.valueProposition || {});
                      handleChange('valueProposition', { ...current, [key]: e.target.value });
                    }}
                    placeholder={placeholder}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="overview-section overview-lead-section">
        <div className="vp-header">
          <h3>Lead Information</h3>
          <button className="btn btn-secondary btn-sm" onClick={handleGenerateICP} disabled={generatingICP}>
            {generatingICP ? <><span className="spinner spinner-sm"></span> Generating...</> : 'Generate ICP'}
          </button>
        </div>
        <div className="overview-grid" style={{ marginBottom: 0 }}>
          <div>
            <div className="form-row mb-16">
              <div className="form-group">
                <label className="form-label">Salutation / Anrede</label>
                <select value={lead.anrede} onChange={(e) => updateLead('anrede', e.target.value)}>
                  <option value="">-- Select --</option>
                  <option value="Herr">Herr</option>
                  <option value="Frau">Frau</option>
                  <option value="Mr.">Mr.</option>
                  <option value="Ms.">Ms.</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="input" value={lead.firstName} onChange={(e) => updateLead('firstName', e.target.value)} placeholder="Jane" />
              </div>
            </div>
            <div className="form-row mb-16">
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="input" value={lead.lastName} onChange={(e) => updateLead('lastName', e.target.value)} placeholder="Smith" />
              </div>
              <div className="form-group">
                <label className="form-label">Position</label>
                <input className="input" value={lead.position} onChange={(e) => updateLead('position', e.target.value)} placeholder="VP of Marketing" />
              </div>
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
