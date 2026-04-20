import { getFactoryStrategyKeys } from './prompts';

const KEYS = {
  AUTH: 'leadhunt_auth',
  API_KEY: 'leadhunt_api_key',
  PROJECTS: 'leadhunt_projects',
  CUSTOM_TOKENS: 'leadhunt_custom_tokens',
  PROMPT_OVERRIDES: 'leadhunt_prompt_overrides',
  STATE_VERSION: 'leadhunt_state_version',
};

// ---------- Shared-state sync (see server/state.js) ----------
let syncTimer = null;
let syncing = false;
let syncAgain = false;

export function getStateVersion() {
  const v = localStorage.getItem(KEYS.STATE_VERSION);
  return v == null ? 0 : Number(v);
}
function setStateVersion(v) {
  localStorage.setItem(KEYS.STATE_VERSION, String(v));
}

// Called from App.jsx on login/mount and every 30s in the background.
// Overwrites the shared-state localStorage keys with the server's copy.
export async function hydrateFromServer() {
  const { fetchState } = await import('./apiClient');
  const s = await fetchState();
  localStorage.setItem(KEYS.PROJECTS, JSON.stringify(s.projects || []));
  localStorage.setItem(
    KEYS.PROMPT_OVERRIDES,
    JSON.stringify(s.promptOverrides || { strategies: {}, staticFollowups: {} })
  );
  localStorage.setItem(KEYS.CUSTOM_TOKENS, JSON.stringify(s.customTokens || []));
  setStateVersion(Number(s.version) || 0);
}

export function scheduleSync() {
  if (syncing) { syncAgain = true; return; }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 300);
}

async function flushSync() {
  if (!getAuth()) return; // not logged in — nothing to sync
  syncing = true;
  try {
    const { pushState } = await import('./apiClient');
    const state = {
      projects: getProjects(),
      promptOverrides: getPromptOverrides() || { strategies: {}, staticFollowups: {} },
      customTokens: getCustomTokens(),
    };
    const res = await pushState(state, getStateVersion());
    if (res.conflict) {
      // Server advanced between our read and write. Replace our local state
      // with the server's and let the user know a save was dropped.
      if (res.current) {
        localStorage.setItem(KEYS.PROJECTS, JSON.stringify(res.current.projects || []));
        localStorage.setItem(
          KEYS.PROMPT_OVERRIDES,
          JSON.stringify(res.current.promptOverrides || { strategies: {}, staticFollowups: {} })
        );
        localStorage.setItem(KEYS.CUSTOM_TOKENS, JSON.stringify(res.current.customTokens || []));
        setStateVersion(Number(res.current.version) || 0);
      } else {
        await hydrateFromServer();
      }
      window.dispatchEvent(new Event('leadhunt:state_conflict'));
      return;
    }
    setStateVersion(Number(res.version) || 0);
  } catch (err) {
    console.error('[sync] push failed', err);
  } finally {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      scheduleSync();
    }
  }
}

const PROMPT_SEP = '\n---\n';
const PRELUDE_SIGNATURE = /^You are a LinkedIn message generator/;

// Lazy migration: fill in seq.strategyKey on legacy sequences so the
// prompt-overrides editor can match them, AND strip legacy full-prompt
// AI messages down to just their body (prelude + postlude are now stored
// globally in Settings and composed at generate time). Mutates `project`
// in place. Returns true if anything changed.
function migrateProjectStrategyKeys(project) {
  if (!project || !Array.isArray(project.sequences)) return false;
  const keys = new Set(getFactoryStrategyKeys());
  let changed = false;
  for (const seq of project.sequences) {
    if (seq && seq.strategyKey === undefined) {
      seq.strategyKey = keys.has(seq.name) ? seq.name : null;
      changed = true;
    }
    if (!Array.isArray(seq?.messages)) continue;
    for (const msg of seq.messages) {
      if (!msg || msg.type !== 'ai') continue;
      if (msg.hasCustomFraming) continue;
      if (typeof msg.prompt !== 'string') continue;
      const parts = msg.prompt.split(PROMPT_SEP);
      if (parts.length >= 3) {
        msg.prompt = parts[1];
        changed = true;
      } else if (PRELUDE_SIGNATURE.test(msg.prompt)) {
        // Starts with the standard prelude but lacks clean separators —
        // the user edited it into something non-splittable. Flag so we
        // don't double-wrap at generate time.
        msg.hasCustomFraming = true;
        changed = true;
      }
      // else: no recognizable framing; treat as already-body. Nothing to do.
    }
  }
  return changed;
}

// Auth
export function getAuth() {
  return localStorage.getItem(KEYS.AUTH);
}
export function setAuth(token) {
  localStorage.setItem(KEYS.AUTH, token);
}
export function clearAuth() {
  localStorage.removeItem(KEYS.AUTH);
}

// API Key
export function getApiKey() {
  return localStorage.getItem(KEYS.API_KEY) || '';
}
export function setApiKey(key) {
  localStorage.setItem(KEYS.API_KEY, key);
}

// Custom access tokens
export function getCustomTokens() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.CUSTOM_TOKENS)) || [];
  } catch {
    return [];
  }
}
export function addCustomToken(token) {
  const tokens = getCustomTokens();
  if (!tokens.includes(token)) {
    tokens.push(token);
    localStorage.setItem(KEYS.CUSTOM_TOKENS, JSON.stringify(tokens));
    scheduleSync();
  }
}

// Projects
export function getProjects() {
  let projects;
  try {
    projects = JSON.parse(localStorage.getItem(KEYS.PROJECTS)) || [];
  } catch {
    return [];
  }
  let anyMigrated = false;
  for (const p of projects) {
    if (migrateProjectStrategyKeys(p)) anyMigrated = true;
  }
  if (anyMigrated) {
    localStorage.setItem(KEYS.PROJECTS, JSON.stringify(projects));
  }
  return projects;
}

export function getProject(id) {
  const project = getProjects().find((p) => p.id === id) || null;
  if (project && typeof project.valueProposition === 'string') {
    project.valueProposition = {
      summary: project.valueProposition,
      elevatorPitch: '', painPoints: '', usps: '', urgency: '', services: '', benefits: '',
    };
  }
  return project;
}

export function saveProject(project) {
  const projects = getProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  if (idx >= 0) {
    projects[idx] = project;
  } else {
    projects.push(project);
  }
  localStorage.setItem(KEYS.PROJECTS, JSON.stringify(projects));
  scheduleSync();
}

export function deleteProject(id) {
  const projects = getProjects().filter((p) => p.id !== id);
  localStorage.setItem(KEYS.PROJECTS, JSON.stringify(projects));
  scheduleSync();
}

// Prompt overrides (global sequence-prompt customizations from Settings)
export function getPromptOverrides() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.PROMPT_OVERRIDES)) || null;
  } catch {
    return null;
  }
}
export function setPromptOverrides(obj) {
  localStorage.setItem(KEYS.PROMPT_OVERRIDES, JSON.stringify(obj));
  scheduleSync();
}
