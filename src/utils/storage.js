const KEYS = {
  AUTH: 'leadhunt_auth',
  API_KEY: 'leadhunt_api_key',
  PROJECTS: 'leadhunt_projects',
  CUSTOM_TOKENS: 'leadhunt_custom_tokens',
};

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
  try {
    return JSON.parse(localStorage.getItem(KEYS.PROJECTS)) || [];
  } catch {
    return [];
  }
}

export function getProject(id) {
  return getProjects().find((p) => p.id === id) || null;
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
