import { useState, useMemo } from 'react';
import {
  getEffectiveStrategyKeys,
  getEffectiveStrategy,
  getEffectiveStaticFollowups,
  applyPromptOverrides,
} from '../utils/promptOverrides';
import { useToast } from './Toast';

function buildInitialDraft() {
  const strategies = {};
  for (const key of getEffectiveStrategyKeys()) {
    const en = getEffectiveStrategy(key, 'en');
    const de = getEffectiveStrategy(key, 'de');
    strategies[key] = {
      displayName: en.displayName,
      delayDays: en.delayDays,
      en: { description: en.description, prompt: en.prompt },
      de: { description: de.description, prompt: de.prompt },
    };
  }
  const staticFollowups = {
    en: getEffectiveStaticFollowups('en').map((f) => ({ label: f.label, delayDays: f.delayDays, prompt: f.prompt })),
    de: getEffectiveStaticFollowups('de').map((f) => ({ label: f.label, delayDays: f.delayDays, prompt: f.prompt })),
  };
  return { strategies, staticFollowups };
}

export default function SequencePromptsEditor() {
  const [lang, setLang] = useState('en');
  const [draft, setDraft] = useState(buildInitialDraft);
  const [expanded, setExpanded] = useState({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const keys = useMemo(() => getEffectiveStrategyKeys(), []);

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

  const handleSave = () => {
    setSaving(true);
    try {
      const overrides = {
        strategies: {},
        staticFollowups: { en: draft.staticFollowups.en, de: draft.staticFollowups.de },
      };
      for (const key of keys) {
        const s = draft.strategies[key];
        overrides.strategies[key] = {
          displayName: s.displayName,
          delayDays: Number(s.delayDays) || 1,
          en: { description: s.en.description, prompt: s.en.prompt },
          de: { description: s.de.description, prompt: s.de.prompt },
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
      </div>
      <p className="text-secondary text-sm" style={{ marginTop: 0, marginBottom: 16 }}>
        Edits apply to all projects where the sequence still matches the current global default.
        Per-project customizations are preserved.
      </p>

      {/* Shared follow-ups */}
      <div className="settings-section" style={{ marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>Shared follow-ups ({lang === 'de' ? 'Deutsch' : 'English'})</h4>
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

      {/* Per-strategy cards */}
      {keys.map((key) => {
        const s = draft.strategies[key];
        const isOpen = !!expanded[key];
        return (
          <div key={key} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
            <div
              style={{ padding: 10, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => toggleExpand(key)}
            >
              <strong>{s.displayName}</strong>
              <span className="text-secondary text-sm">{isOpen ? '▼' : '▶'} {key !== s.displayName && `(${key})`}</span>
            </div>
            {isOpen && (
              <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
                <div className="settings-row" style={{ gap: 8 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">DISPLAY NAME (SHARED ACROSS LANGUAGES)</label>
                    <input
                      className="input"
                      value={s.displayName}
                      onChange={(e) => updateStrategy(key, { displayName: e.target.value })}
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
                  <label className="form-label">MESSAGE 1 PROMPT ({lang === 'de' ? 'DEUTSCH' : 'ENGLISH'})</label>
                  <textarea
                    className="textarea"
                    rows={14}
                    value={s[lang].prompt}
                    onChange={(e) => updateStrategyLang(key, lang, { prompt: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <><span className="spinner spinner-sm"></span> Saving...</> : 'Save'}
        </button>
      </div>
    </div>
  );
}
