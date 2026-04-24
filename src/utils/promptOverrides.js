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

// Stale factory descriptions that existed BEFORE the "What It Is / Hypothesis"
// rewrite. If a user clicked "Save" in Settings while these were in effect,
// the old strings got baked into their overrides and now mask the new factory
// text. We strip any override description that matches these old values so
// the new factory descriptions shine through. Idempotent — running multiple
// times is safe because the mismatch disappears after the first cleanup.
const STALE_FACTORY_DESCRIPTIONS = {
  'Centre of Excellence': {
    en: "Positions your company as building a centre of excellence in the prospect's country.",
    de: 'Positioniert Ihr Unternehmen beim Aufbau eines Kompetenzzentrums im Land des Kontakts.',
  },
  'Would It Be Valuable': {
    en: "Leads with a specific outcome question tailored to the prospect's company.",
    de: 'Beginnt mit einer spezifischen Ergebnisfrage, zugeschnitten auf das Unternehmen des Kontakts.',
  },
  'Responsibility-Driven Pain Point': {
    en: "Shows empathy for the prospect's role challenges and offers a solution framed as a question.",
    de: 'Zeigt Empathie für die Herausforderungen der Rolle und bietet eine Lösung als Frage formuliert.',
  },
  'Offer Feedback Request': {
    en: 'Asks the prospect for honest feedback on your solution, positioning them as an expert.',
    de: 'Bittet den Kontakt um ehrliches Feedback zur Lösung und positioniert ihn als Experten.',
  },
  'Topic Insight Request': {
    en: "Frames outreach around a research topic relevant to the prospect's expertise.",
    de: 'Rahmt die Kontaktaufnahme um ein Forschungsthema, das zur Expertise des Kontakts passt.',
  },
  'Direct Pitch V1': {
    en: 'A direct pitch that leads with common challenges and positions your solution.',
    de: 'Ein direkter Pitch, der mit häufigen Herausforderungen beginnt und Ihre Lösung positioniert.',
  },
  'Direct Pitch V2': {
    en: "A concise direct pitch that references the prospect's industry focus and offers relevance.",
    de: 'Ein prägnanter direkter Pitch, der den Branchenfokus des Kontakts referenziert.',
  },
  'Micro-Question': {
    en: 'A short, conversational message with one easy-to-answer question.',
    de: 'Eine kurze, umgangssprachliche Nachricht mit einer einfach zu beantwortenden Frage.',
  },
  'Honest Outreach': {
    en: 'A straightforward message that openly states intent and asks if the challenge is relevant.',
    de: 'Eine direkte Nachricht, die offen die Absicht nennt und fragt, ob die Herausforderung relevant ist.',
  },
  'Peer Insight': {
    en: 'Shares a recurring theme from peers and asks if the prospect sees the same.',
    de: 'Teilt ein wiederkehrendes Thema von Kollegen und fragt, ob der Kontakt dasselbe sieht.',
  },
  'Give-First': {
    en: 'Leads by sharing a useful insight without asking for anything in return.',
    de: 'Beginnt mit einer nützlichen Erkenntnis, ohne etwas im Gegenzug zu verlangen.',
  },
  'Specific Observation': {
    en: "A short message that makes a direct observation about the prospect's company.",
    de: 'Eine kurze Nachricht mit einer direkten Beobachtung über das Unternehmen des Kontakts.',
  },
  'Contrarian Take': {
    en: 'Challenges a common industry approach and asks where the prospect stands.',
    de: 'Hinterfragt einen gängigen Branchenansatz und fragt, wo der Kontakt steht.',
  },
  'Role-Empathy Opener': {
    en: "Opens with genuine empathy for the prospect's role pressures.",
    de: 'Beginnt mit echtem Verständnis für den Druck der Rolle des Kontakts.',
  },
};

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
  // Strip stale description overrides so new factory "What It Is / Hypothesis"
  // descriptions show up.
  for (const [key, old] of Object.entries(STALE_FACTORY_DESCRIPTIONS)) {
    const strat = o.strategies?.[key];
    if (!strat || strat.custom) continue;
    for (const lang of ['en', 'de']) {
      if (strat[lang]?.description === old[lang]) {
        delete strat[lang].description;
        mutated = true;
      }
    }
  }
  if (mutated) setPromptOverrides(o);
  return o;
}

// Update any project sequence whose description still matches the old stale
// factory text, so "Show descriptions" in the Sequences tab reflects the new
// text. Returns the number of projects changed.
export function migrateStaleSequenceDescriptions() {
  const projects = getProjects();
  let changedCount = 0;
  for (const project of projects) {
    const lang = project.language || 'en';
    let projectChanged = false;
    for (const seq of project.sequences || []) {
      if (!seq.strategyKey) continue;
      const old = STALE_FACTORY_DESCRIPTIONS[seq.strategyKey];
      if (!old) continue;
      if (seq.description === old[lang]) {
        const eff = getEffectiveStrategy(seq.strategyKey, lang);
        if (eff.description && eff.description !== seq.description) {
          seq.description = eff.description;
          projectChanged = true;
        }
      }
    }
    if (projectChanged) {
      saveProject(project);
      changedCount++;
    }
  }
  return changedCount;
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
  const factoryKeys = getFactoryStrategyKeys();
  const o = loadOverrides();
  const customKeys = Object.keys(o.strategies || {}).filter(
    (k) => o.strategies[k] && o.strategies[k].custom === true && !factoryKeys.includes(k)
  );
  return [...factoryKeys, ...customKeys];
}

export function isCustomStrategy(key) {
  const o = loadOverrides();
  return !!(o.strategies?.[key]?.custom);
}

export function deleteCustomStrategy(key) {
  const o = loadOverrides();
  if (!o.strategies || !o.strategies[key] || !o.strategies[key].custom) return;
  const next = { ...o, strategies: { ...o.strategies } };
  delete next.strategies[key];
  setPromptOverrides(next);
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
  for (const key of getEffectiveStrategyKeys()) {
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
