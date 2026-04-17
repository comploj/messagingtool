import { getFactoryStrategyKeys } from './prompts';

const KEYS = {
  AUTH: 'leadhunt_auth',
  API_KEY: 'leadhunt_api_key',
  PROJECTS: 'leadhunt_projects',
  CUSTOM_TOKENS: 'leadhunt_custom_tokens',
  PROMPT_OVERRIDES: 'leadhunt_prompt_overrides',
};

// Lazy migration: fill in seq.strategyKey on legacy sequences so the
// prompt-overrides editor can match them. Mutates `project` in place.
// Returns true if anything changed.
function migrateProjectStrategyKeys(project) {
  if (!project || !Array.isArray(project.sequences)) return false;
  const keys = new Set(getFactoryStrategyKeys());
  let changed = false;
  for (const seq of project.sequences) {
    if (seq && seq.strategyKey === undefined) {
      seq.strategyKey = keys.has(seq.name) ? seq.name : null;
      changed = true;
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
}

export function deleteProject(id) {
  const projects = getProjects().filter((p) => p.id !== id);
  localStorage.setItem(KEYS.PROJECTS, JSON.stringify(projects));
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
}
