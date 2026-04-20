import { useState, useMemo } from 'react';
import {
  getEffectiveStrategyKeys,
  getEffectiveStrategy,
  getEffectiveStaticFollowups,
  getEffectivePrelude,
  getEffectivePostlude,
  applyPromptOverrides,
  isCustomStrategy,
  deleteCustomStrategy,
} from '../utils/promptOverrides';
import { useToast } from './Toast';

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function uniqueKey(base, existing) {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function buildInitialDraft() {
  const strategies = {};
  for (const key of getEffectiveStrategyKeys()) {
    const en = getEffectiveStrategy(key, 'en');
    const de = getEffectiveStrategy(key, 'de');
    strategies[key] = {
      custom: isCustomStrategy(key),
      delayDays: en.delayDays,
      en: { displayName: en.displayName, description: en.description, prompt: en.prompt },
      de: { displayName: de.displayName, description: de.description, prompt: de.prompt },
    };
  }
  const staticFollowups = {
    en: getEffectiveStaticFollowups('en').map((f) => ({ label: f.label, delayDays: f.delayDays, prompt: f.prompt })),
    de: getEffectiveStaticFollowups('de').map((f) => ({ label: f.label, delayDays: f.delayDays, prompt: f.prompt })),
  };
  const framing = {
    en: { prelude: getEffectivePrelude('en'), postlude: getEffectivePostlude('en') },
    de: { prelude: getEffectivePrelude('de'), postlude: getEffectivePostlude('de') },
  };
  return { strategies, staticFollowups, framing };
}

export default function SequencePromptsEditor() {
  const [lang, setLang] = useState('en');
  const [draft, setDraft] = useState(buildInitialDraft);
  const [expanded, setExpanded] = useState({});
  const [framingOpen, setFramingOpen] = useState(false);
  const [followupsOpen, setFollowupsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', description: '', prompt: '', delayDays: 1 });
  const toast = useToast();
  const keys = useMemo(() => Object.keys(draft.strategies), [draft.strategies]);

  const updateStrategy = (key, patch) => {
    setDraft((d) => ({
      ...d,
      strategies: {
        ...d.strategies,
        [key]: { ...d.strategies[key], ...patch },
      },
    }));
  };

  const updateStrategyLang = (key, lg, patch) => {
    setDraft((d) => ({
      ...d,
      strategies: {
        ...d.strategies,
        [key]: {
          ...d.strategies[key],
          [lg]: { ...d.strategies[key][lg], ...patch },
        },
      },
    }));
  };

  const updateFollowup = (lg, idx, patch) => {
    setDraft((d) => {
      const next = d.staticFollowups[lg].map((f, i) => (i === idx ? { ...f, ...patch } : f));
      return { ...d, staticFollowups: { ...d.staticFollowups, [lg]: next } };
    });
  };

  const updateFraming = (lg, patch) => {
    setDraft((d) => ({
      ...d,
      framing: { ...d.framing, [lg]: { ...d.framing[lg], ...patch } },
    }));
  };

  const handleSave = () => {
    setSaving(true);
    try {
      const overrides = {
        strategies: {},
        staticFollowups: { en: draft.staticFollowups.en, de: draft.staticFollowups.de },
        prelude: { en: draft.framing.en.prelude, de: draft.framing.de.prelude },
        postlude: { en: draft.framing.en.postlude, de: draft.framing.de.postlude },
      };
      for (const key of keys) {
        const s = draft.strategies[key];
        overrides.strategies[key] = {
          ...(s.custom ? { custom: true } : {}),
          delayDays: Number(s.delayDays) || 1,
          en: { displayName: s.en.displayName, description: s.en.description, prompt: s.en.prompt },
          de: { displayName: s.de.displayName, description: s.de.description, prompt: s.de.prompt },
        };
      }
      const { changedProjects } = applyPromptOverrides(overrides);
      toast.success(`Saved — applied to ${changedProjects} project${changedProjects === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = (key) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

  const handleCreateCustom = () => {
    const name = newForm.name.trim();
    if (!name) { toast.error('Name is required'); return; }
    const prompt = newForm.prompt.trim();
    if (!prompt) { toast.error('Prompt template is required'); return; }
    const base = slugify(name) || 'custom-strategy';
    const key = uniqueKey(base, Object.keys(draft.strategies));
    const delayDays = Number(newForm.delayDays) || 1;
    const entry = {
      custom: true,
      delayDays,
      en: { displayName: name, description: newForm.description, prompt },
      de: { displayName: name, description: newForm.description, prompt },
    };
    const nextDraft = {
      ...draft,
      strategies: { ...draft.strategies, [key]: entry },
    };
    setDraft(nextDraft);
    setExpanded((e) => ({ ...e, [key]: true }));

    // Persist immediately so reload keeps it
    try {
      const overrides = {
        strategies: {},
        staticFollowups: { en: nextDraft.staticFollowups.en, de: nextDraft.staticFollowups.de },
        prelude: { en: nextDraft.framing.en.prelude, de: nextDraft.framing.de.prelude },
        postlude: { en: nextDraft.framing.en.postlude, de: nextDraft.framing.de.postlude },
      };
      for (const k of Object.keys(nextDraft.strategies)) {
        const s = nextDraft.strategies[k];
        overrides.strategies[k] = {
          ...(s.custom ? { custom: true } : {}),
          delayDays: Number(s.delayDays) || 1,
          en: { displayName: s.en.displayName, description: s.en.description, prompt: s.en.prompt },
          de: { displayName: s.de.displayName, description: s.de.description, prompt: s.de.prompt },
        };
      }
      applyPromptOverrides(overrides);
      toast.success('Custom strategy added');
    } catch (err) {
      toast.error('Could not save: ' + err.message);
    }

    setNewOpen(false);
    setNewForm({ name: '', description: '', prompt: '', delayDays: 1 });
  };

  const handleDeleteCustom = (key) => {
    const s = draft.strategies[key];
    const label = s?.en?.displayName || s?.de?.displayName || key;
    if (!confirm(`Delete custom strategy "${label}"? This cannot be undone.`)) return;
    deleteCustomStrategy(key);
    setDraft((d) => {
      const next = { ...d, strategies: { ...d.strategies } };
      delete next.strategies[key];
      return next;
    });
    setExpanded((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
    toast.success('Strategy deleted');
  };

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Sequence Prompts</h3>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`btn btn-sm ${lang === 'en' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setLang('en')}
          >
            English
          </button>
          <button
            className={`btn btn-sm ${lang === 'de' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setLang('de')}
          >
            Deutsch
          </button>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <><span className="spinner spinner-sm"></span> Saving...</> : 'Save'}
        </button>
        <button className="btn btn-secondary" onClick={() => setNewOpen(true)} title="Add new strategy">
          + New Strategy
        </button>
      </div>
      <p className="text-secondary text-sm" style={{ marginTop: 0, marginBottom: 16 }}>
        Edits apply to all projects where the sequence still matches the current global default.
        Per-project customizations are preserved.
      </p>

      {/* Prompt framing — shared across every strategy; only visible here.
          Collapsible + accent-tinted so it's visually distinct from per-strategy cards. */}
      <div
        style={{
          marginBottom: 8,
          border: '1px solid var(--accent)',
          borderRadius: 6,
          background: 'rgba(99, 102, 241, 0.08)',
        }}
      >
        <div
          style={{ padding: 10, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          onClick={() => setFramingOpen((v) => !v)}
        >
          <strong>Prompt framing — shared (your IP, {lang === 'de' ? 'Deutsch' : 'English'})</strong>
          <span className="text-secondary text-sm">{framingOpen ? '▼' : '▶'}</span>
        </div>
        {framingOpen && (
          <div style={{ padding: 12, borderTop: '1px solid var(--accent)' }}>
            <p className="text-secondary text-sm" style={{ marginTop: 0 }}>
              Prepended and appended to every AI message at generate time. Hidden from per-sequence editors.
            </p>
            <div className="form-group">
              <label className="form-label">PRELUDE ({lang === 'de' ? 'DEUTSCH' : 'ENGLISH'})</label>
              <textarea
                className="textarea textarea-mono"
                rows={12}
                value={draft.framing[lang].prelude}
                onChange={(e) => updateFraming(lang, { prelude: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">POSTLUDE ({lang === 'de' ? 'DEUTSCH' : 'ENGLISH'})</label>
              <textarea
                className="textarea textarea-mono"
                rows={8}
                value={draft.framing[lang].postlude}
                onChange={(e) => updateFraming(lang, { postlude: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      {/* Shared follow-ups — also global, collapsible, same accent tint. */}
      <div
        style={{
          marginBottom: 16,
          border: '1px solid var(--accent)',
          borderRadius: 6,
          background: 'rgba(99, 102, 241, 0.08)',
        }}
      >
        <div
          style={{ padding: 10, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          onClick={() => setFollowupsOpen((v) => !v)}
        >
          <strong>Shared follow-ups ({lang === 'de' ? 'Deutsch' : 'English'})</strong>
          <span className="text-secondary text-sm">{followupsOpen ? '▼' : '▶'}</span>
        </div>
        {followupsOpen && (
          <div style={{ padding: 12, borderTop: '1px solid var(--accent)' }}>
            <p className="text-secondary text-sm" style={{ marginTop: 0 }}>
              These two static messages are appended to every sequence as Message 2 and Message 3.
            </p>
            {draft.staticFollowups[lang].map((f, i) => (
              <div key={i} style={{ marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
                <div className="settings-row" style={{ gap: 8 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">LABEL</label>
                    <input
                      className="input"
                      value={f.label}
                      onChange={(e) => updateFollowup(lang, i, { label: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ width: 120 }}>
                    <label className="form-label">DELAY (DAYS)</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={f.delayDays}
                      onChange={(e) => updateFollowup(lang, i, { delayDays: parseInt(e.target.value) || 1 })}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">PROMPT</label>
                  <textarea
                    className="textarea"
                    rows={4}
                    value={f.prompt}
                    onChange={(e) => updateFollowup(lang, i, { prompt: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-strategy cards */}
      {keys.map((key) => {
        const s = draft.strategies[key];
        const isOpen = !!expanded[key];
        const headerName = s[lang].displayName || s.en.displayName || key;
        return (
          <div key={key} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
            <div
              style={{ padding: 10, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => toggleExpand(key)}
            >
              <strong>{headerName}</strong>
              <span className="text-secondary text-sm">{isOpen ? '▼' : '▶'} {key !== headerName && `(${key})`}</span>
            </div>
            {isOpen && (
              <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
                <div className="settings-row" style={{ gap: 8 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">DISPLAY NAME ({lang === 'de' ? 'DEUTSCH' : 'ENGLISH'})</label>
                    <input
                      className="input"
                      value={s[lang].displayName}
                      onChange={(e) => updateStrategyLang(key, lang, { displayName: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ width: 140 }}>
                    <label className="form-label">MSG 1 DELAY (DAYS)</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={s.delayDays}
                      onChange={(e) => updateStrategy(key, { delayDays: parseInt(e.target.value) || 1 })}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">DESCRIPTION ({lang === 'de' ? 'DEUTSCH' : 'ENGLISH'})</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    value={s[lang].description}
                    onChange={(e) => updateStrategyLang(key, lang, { description: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">MESSAGE TEMPLATE ({lang === 'de' ? 'DEUTSCH' : 'ENGLISH'})</label>
                  <p className="text-secondary text-sm" style={{ marginTop: -4, marginBottom: 6 }}>
                    Only the message body — the prompt framing around it lives in the card at the top.
                  </p>
                  <textarea
                    className="textarea textarea-mono"
                    rows={14}
                    value={s[lang].prompt}
                    onChange={(e) => updateStrategyLang(key, lang, { prompt: e.target.value })}
                  />
                </div>
                {s.custom && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteCustom(key)}>
                      Delete strategy
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => setNewOpen(true)}>
          + New Strategy
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <><span className="spinner spinner-sm"></span> Saving...</> : 'Save'}
        </button>
      </div>

      {newOpen && (
        <div className="modal-overlay" onClick={() => setNewOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Custom Strategy</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setNewOpen(false)}>&times;</button>
            </div>
            <p className="text-secondary text-sm" style={{ marginTop: 0, marginBottom: 12 }}>
              Define a new sequence strategy. You can refine per-language text after creating it.
            </p>
            <div className="form-group mb-16">
              <label className="form-label">NAME</label>
              <input
                className="input"
                value={newForm.name}
                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Industry Case Study"
                autoFocus
              />
            </div>
            <div className="form-group mb-16">
              <label className="form-label">DESCRIPTION (OPTIONAL)</label>
              <textarea
                className="textarea"
                rows={2}
                value={newForm.description}
                onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Short description of when to use this strategy"
              />
            </div>
            <div className="form-group mb-16">
              <label className="form-label">MSG 1 DELAY (DAYS)</label>
              <input
                className="input"
                type="number"
                min={1}
                style={{ width: 140 }}
                value={newForm.delayDays}
                onChange={(e) => setNewForm((f) => ({ ...f, delayDays: parseInt(e.target.value) || 1 }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">PROMPT TEMPLATE</label>
              <textarea
                className="textarea textarea-mono"
                rows={10}
                value={newForm.prompt}
                onChange={(e) => setNewForm((f) => ({ ...f, prompt: e.target.value }))}
                placeholder="Write the message body — the prompt framing (prelude/postlude) is added automatically."
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setNewOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateCustom}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
