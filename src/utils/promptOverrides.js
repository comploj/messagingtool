import {
  getFactoryStrategy,
  getFactoryStrategyKeys,
  getFactoryStaticFollowups,
  getFactoryPrelude,
  getFactoryPostlude,
} from './prompts';
import { getPromptOverrides, setPromptOverrides, getProjects, saveProject } from './storage';

const DEFAULT_FIRST_MESSAGE_DELAY = 1;
const SEP = '\n---\n';

export function loadOverrides() {
  const o = getPromptOverrides() || { strategies: {}, staticFollowups: {} };
  // Migrate legacy full-prompt overrides down to just the body so the editor
  // UI and downstream composition never see prelude/postlude mixed in.
  let mutated = false;
  for (const key of Object.keys(o.strategies || {})) {
    for (const lang of ['en', 'de']) {
      const lv = o.strategies[key][lang];
      if (!lv || typeof lv.prompt !== 'string') continue;
      const parts = lv.prompt.split(SEP);
      if (parts.length >= 3) {
        lv.prompt = parts[1];
        mutated = true;
      }
    }
  }
  if (mutated) setPromptOverrides(o);
  return o;
}
export function saveOverrides(o) {
  setPromptOverrides(o);
}

export function getEffectivePrelude(lang) {
  const o = loadOverrides();
  return o.prelude?.[lang] ?? getFactoryPrelude(lang);
}
export function getEffectivePostlude(lang) {
  const o = loadOverrides();
  return o.postlude?.[lang] ?? getFactoryPostlude(lang);
}

// Returns the effective (override-or-factory) values for a strategy in a language.
// displayName is per-language; legacy language-neutral stratOv.displayName is still
// honored as a fallback so blobs written before this migration keep working.
export function getEffectiveStrategy(key, lang) {
  const o = loadOverrides();
  const factory = getFactoryStrategy(key, lang);
  const stratOv = o.strategies?.[key] || {};
  const langOv = stratOv[lang] || {};
  return {
    displayName: langOv.displayName ?? stratOv.displayName ?? key,
    description: langOv.description ?? factory.description ?? '',
    prompt: langOv.prompt ?? factory.prompt ?? '',
    delayDays: stratOv.delayDays ?? DEFAULT_FIRST_MESSAGE_DELAY,
  };
}

export function getEffectiveStrategyKeys() {
  return getFactoryStrategyKeys();
}

export function getEffectiveStrategyDisplayName(key, lang) {
  return getEffectiveStrategy(key, lang).displayName;
}

export function getEffectiveStaticFollowups(lang) {
  const o = loadOverrides();
  const factory = getFactoryStaticFollowups(lang);
  const ov = o.staticFollowups?.[lang] || [];
  return factory.map((f, i) => ({
    label: ov[i]?.label ?? f.label,
    type: 'static',
    delayDays: ov[i]?.delayDays ?? f.delayDays,
    prompt: ov[i]?.prompt ?? f.prompt,
  }));
}

// Build a full snapshot of all editable fields in every language at once.
// Used on Save to diff old vs new and decide which project fields can be overwritten.
function buildSnapshot() {
  const strategies = {};
  for (const key of getFactoryStrategyKeys()) {
    const en = getEffectiveStrategy(key, 'en');
    const de = getEffectiveStrategy(key, 'de');
    strategies[key] = {
      delayDays: en.delayDays,
      en: { displayName: en.displayName, description: en.description, prompt: en.prompt },
      de: { displayName: de.displayName, description: de.description, prompt: de.prompt },
    };
  }
  return {
    strategies,
    staticFollowups: {
      en: getEffectiveStaticFollowups('en'),
      de: getEffectiveStaticFollowups('de'),
    },
  };
}

// Save-button flow. Writes overrides, then walks every project and
// overwrites any sequence fields that still match the OLD effective defaults.
// Fields that diverged (per-project customizations) are preserved.
export function applyPromptOverrides(nextOverrides) {
  const oldSnap = buildSnapshot();
  saveOverrides(nextOverrides);
  const newSnap = buildSnapshot();

  let changedProjects = 0;
  const projects = getProjects();
  for (const project of projects) {
    const lang = project.language || 'en';
    let projectChanged = false;
    if (!Array.isArray(project.sequences)) continue;
    for (const seq of project.sequences) {
      const key = seq.strategyKey;
      if (!key || !oldSnap.strategies[key]) continue;
      const oldS = oldSnap.strategies[key];
      const newS = newSnap.strategies[key];
      // Display name (per project language)
      if (seq.name === oldS[lang].displayName && seq.name !== newS[lang].displayName) {
        seq.name = newS[lang].displayName;
        projectChanged = true;
      }
      // Description (per project language)
      if (seq.description === oldS[lang].description && seq.description !== newS[lang].description) {
        seq.description = newS[lang].description;
        projectChanged = true;
      }
      if (!Array.isArray(seq.messages)) continue;
      // AI Message 1 (first message, type ai)
      const aiMsg = seq.messages[0];
      if (aiMsg && aiMsg.type === 'ai') {
        if (aiMsg.prompt === oldS[lang].prompt && aiMsg.prompt !== newS[lang].prompt) {
          aiMsg.prompt = newS[lang].prompt;
          projectChanged = true;
        }
        if (aiMsg.delayDays === oldS.delayDays && aiMsg.delayDays !== newS.delayDays) {
          aiMsg.delayDays = newS.delayDays;
          projectChanged = true;
        }
      }
      // Static follow-ups (messages[1..]) — shared across all strategies
      for (let i = 1; i < seq.messages.length; i++) {
        const msg = seq.messages[i];
        if (!msg || msg.type !== 'static') continue;
        const oldF = oldSnap.staticFollowups[lang][i - 1];
        const newF = newSnap.staticFollowups[lang][i - 1];
        if (!oldF || !newF) continue;
        if (msg.label === oldF.label && msg.label !== newF.label) {
          msg.label = newF.label;
          projectChanged = true;
        }
        if (msg.prompt === oldF.prompt && msg.prompt !== newF.prompt) {
          msg.prompt = newF.prompt;
          projectChanged = true;
        }
        if (msg.delayDays === oldF.delayDays && msg.delayDays !== newF.delayDays) {
          msg.delayDays = newF.delayDays;
          projectChanged = true;
        }
      }
    }
    if (projectChanged) {
      saveProject(project);
      changedProjects++;
    }
  }
  return { changedProjects };
}
