import { getFactoryStrategyKeys } from './prompts';

const KEYS = {
  AUTH: 'leadhunt_auth',
  API_KEY: 'leadhunt_api_key',           // legacy single Anthropic key, migrated lazily
  API_KEYS: 'leadhunt_api_keys',         // NEW map: { providerId: apiKey }
  PROJECTS: 'leadhunt_projects',
  CUSTOMERS: 'leadhunt_customers',
  CUSTOM_TOKENS: 'leadhunt_custom_tokens',
  PROMPT_OVERRIDES: 'leadhunt_prompt_overrides',
  SDR_WORKFLOWS: 'leadhunt_sdr_workflows',
  AI_PROVIDERS: 'leadhunt_ai_providers',
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
  localStorage.setItem(KEYS.CUSTOMERS, JSON.stringify(s.customers || []));
  localStorage.setItem(
    KEYS.PROMPT_OVERRIDES,
    JSON.stringify(s.promptOverrides || { strategies: {}, staticFollowups: {} })
  );
  localStorage.setItem(KEYS.CUSTOM_TOKENS, JSON.stringify(s.customTokens || []));
  localStorage.setItem(KEYS.SDR_WORKFLOWS, JSON.stringify(s.sdrWorkflows || []));
  localStorage.setItem(KEYS.AI_PROVIDERS, JSON.stringify(s.aiProviders || []));
  // API keys are now shared via the server. Merge so locally-only keys
  // (e.g. from before this change, or set while offline) get pushed up
  // instead of clobbered. Server wins per-key on conflict.
  const local = readApiKeys();
  const legacyAnthropic = localStorage.getItem(KEYS.API_KEY);
  if (legacyAnthropic && !local.anthropic) local.anthropic = legacyAnthropic;
  const serverKeys = (s.apiKeys && typeof s.apiKeys === 'object' && !Array.isArray(s.apiKeys))
    ? s.apiKeys
    : {};
  const merged = { ...local, ...serverKeys };
  let needsPush = false;
  for (const [k, v] of Object.entries(local)) {
    if (v && !serverKeys[k]) { needsPush = true; break; }
  }
  writeApiKeys(merged);
  setStateVersion(Number(s.version) || 0);
  if (needsPush) scheduleSync();
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
      customers: getCustomers(),
      promptOverrides: getPromptOverrides() || { strategies: {}, staticFollowups: {} },
      customTokens: getCustomTokens(),
      sdrWorkflows: getSdrWorkflows(),
      aiProviders: getAiProviders(),
      apiKeys: getApiKeyMap(),
    };
    const res = await pushState(state, getStateVersion());
    if (res.conflict) {
      // Server advanced between our read and write. Replace our local state
      // with the server's and let the user know a save was dropped.
      if (res.current) {
        localStorage.setItem(KEYS.PROJECTS, JSON.stringify(res.current.projects || []));
        localStorage.setItem(KEYS.CUSTOMERS, JSON.stringify(res.current.customers || []));
        localStorage.setItem(
          KEYS.PROMPT_OVERRIDES,
          JSON.stringify(res.current.promptOverrides || { strategies: {}, staticFollowups: {} })
        );
        localStorage.setItem(KEYS.CUSTOM_TOKENS, JSON.stringify(res.current.customTokens || []));
        localStorage.setItem(KEYS.SDR_WORKFLOWS, JSON.stringify(res.current.sdrWorkflows || []));
        localStorage.setItem(KEYS.AI_PROVIDERS, JSON.stringify(res.current.aiProviders || []));
        const serverKeys = (res.current.apiKeys && typeof res.current.apiKeys === 'object' && !Array.isArray(res.current.apiKeys))
          ? res.current.apiKeys
          : {};
        writeApiKeys(serverKeys);
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

// API keys — shared across the team via /api/state, cached locally for
// synchronous reads. Anyone with a valid login token can read and overwrite.
// Backward-compatible: getApiKey() with no arg == getApiKey('anthropic') and also
// falls back to the legacy single-key localStorage entry the first time through
// (migrating it into the new map).
function readApiKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEYS.API_KEYS));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}
function writeApiKeys(map) {
  localStorage.setItem(KEYS.API_KEYS, JSON.stringify(map));
}

export function getApiKey(providerId = 'anthropic') {
  const map = readApiKeys();
  if (map[providerId]) return map[providerId];
  // Legacy: single-key entry has always been the Anthropic key.
  if (providerId === 'anthropic') {
    const legacy = localStorage.getItem(KEYS.API_KEY);
    if (legacy) {
      map.anthropic = legacy;
      writeApiKeys(map);
      return legacy;
    }
  }
  return '';
}

export function setApiKey(providerIdOrKey, maybeKey) {
  // Backward-compatible: setApiKey(key) still works (writes to anthropic).
  let providerId;
  let key;
  if (maybeKey === undefined) {
    providerId = 'anthropic';
    key = providerIdOrKey;
  } else {
    providerId = providerIdOrKey;
    key = maybeKey;
  }
  const map = readApiKeys();
  if (key == null || key === '') delete map[providerId];
  else map[providerId] = key;
  writeApiKeys(map);
  // Keep the legacy single-key in sync so old reads still work during the
  // deprecation window.
  if (providerId === 'anthropic') {
    if (key) localStorage.setItem(KEYS.API_KEY, key);
    else localStorage.removeItem(KEYS.API_KEY);
  }
  // Keys are now shared across the team via the server.
  scheduleSync();
}

export function getApiKeyMap() {
  return readApiKeys();
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
  // Client-side backfill: guarantee every project has a customerId. Mirrors
  // the server's migrateStore so a page hydrated before the server migrated
  // still has a working grouping layer.
  if (projects.some((p) => !p.customerId)) {
    const customers = readCustomersRaw();
    const byName = new Map();
    for (const c of customers) byName.set((c.name || '').trim() || 'Uncategorized', c);
    let customersMutated = false;
    for (const p of projects) {
      if (p.customerId) continue;
      const name = (p.clientName || '').trim() || 'Uncategorized';
      let cust = byName.get(name);
      if (!cust) {
        cust = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
        byName.set(name, cust);
        customers.push(cust);
        customersMutated = true;
      }
      p.customerId = cust.id;
      anyMigrated = true;
    }
    if (customersMutated) {
      localStorage.setItem(KEYS.CUSTOMERS, JSON.stringify(customers));
    }
  }
  if (anyMigrated) {
    localStorage.setItem(KEYS.PROJECTS, JSON.stringify(projects));
  }
  return projects;
}

function readCustomersRaw() {
  try { return JSON.parse(localStorage.getItem(KEYS.CUSTOMERS)) || []; } catch { return []; }
}

// Lazy migration: move per-project lead / outputs from their old localStorage
// keys into the project object itself so they sync to the server and become
// available to the read-only share view. Runs once per project — idempotent.
function migrateLeadAndOutputs(project) {
  if (!project) return false;
  let changed = false;
  if (!project.lead) {
    try {
      const raw = localStorage.getItem(`leadhunt_lead_${project.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          project.lead = parsed;
          changed = true;
        }
      }
    } catch {}
    if (changed) localStorage.removeItem(`leadhunt_lead_${project.id}`);
  }
  if (!project.outputs) {
    try {
      const raw = localStorage.getItem(`leadhunt_outputs_${project.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          project.outputs = parsed;
          changed = true;
        }
      }
    } catch {}
    if (changed) localStorage.removeItem(`leadhunt_outputs_${project.id}`);
  }
  return changed;
}

export function getProject(id) {
  const projects = getProjects();
  const project = projects.find((p) => p.id === id) || null;
  if (!project) return null;
  if (typeof project.valueProposition === 'string') {
    project.valueProposition = {
      summary: project.valueProposition,
      elevatorPitch: '', painPoints: '', usps: '', urgency: '', services: '', benefits: '',
    };
  }
  if (migrateLeadAndOutputs(project)) {
    // Persist migration back to localStorage + trigger sync so lead/outputs
    // land on the server (needed for live share to see them).
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) projects[idx] = project;
    localStorage.setItem(KEYS.PROJECTS, JSON.stringify(projects));
    scheduleSync();
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

// Customers
export function getCustomers() {
  return readCustomersRaw();
}

export function getCustomer(id) {
  return getCustomers().find((c) => c.id === id) || null;
}

export function saveCustomer(customer) {
  const list = getCustomers();
  const idx = list.findIndex((c) => c.id === customer.id);
  if (idx >= 0) list[idx] = customer; else list.push(customer);
  localStorage.setItem(KEYS.CUSTOMERS, JSON.stringify(list));
  scheduleSync();
}

// Cascade: deleting a customer deletes every project with that customerId.
export function deleteCustomer(id) {
  const remaining = getCustomers().filter((c) => c.id !== id);
  localStorage.setItem(KEYS.CUSTOMERS, JSON.stringify(remaining));
  const remainingProjects = getProjects().filter((p) => p.customerId !== id);
  localStorage.setItem(KEYS.PROJECTS, JSON.stringify(remainingProjects));
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

// AI providers — shared catalogue, synced via server.
export function getAiProviders() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.AI_PROVIDERS)) || [];
  } catch {
    return [];
  }
}
export function getAiProvider(id) {
  return getAiProviders().find((p) => p.id === id) || null;
}
export function saveAiProvider(provider) {
  const list = getAiProviders();
  const idx = list.findIndex((p) => p.id === provider.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...provider }; else list.push(provider);
  localStorage.setItem(KEYS.AI_PROVIDERS, JSON.stringify(list));
  scheduleSync();
}
export function deleteAiProvider(id) {
  const list = getAiProviders().filter((p) => p.id !== id);
  localStorage.setItem(KEYS.AI_PROVIDERS, JSON.stringify(list));
  scheduleSync();
}

// AI SDR workflows — shared across all projects. Migrates legacy
// single-prompt workflows into the layered shape on read.
function randomLayerId(workflowId) {
  const id = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  return workflowId ? `${workflowId}-layer-${id.slice(0, 8)}` : `layer-${id}`;
}

function migrateWorkflow(w) {
  if (!w || typeof w !== 'object') return w;
  if (Array.isArray(w.layers) && w.layers.length > 0) return w;
  const content = typeof w.prompt === 'string' ? w.prompt : '';
  const { prompt: _legacy, ...rest } = w;
  return {
    ...rest,
    layers: [{
      id: randomLayerId(w.id),
      name: 'Respond',
      description: '',
      providerId: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemMessage: '',
      temperature: 0.6,
      content,
    }],
  };
}

export function getSdrWorkflows() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(KEYS.SDR_WORKFLOWS)) || []; }
  catch { return []; }
  if (!Array.isArray(raw)) return [];
  const migrated = raw.map(migrateWorkflow);
  const anyChanged = migrated.some((w, i) => w !== raw[i]);
  if (anyChanged) {
    localStorage.setItem(KEYS.SDR_WORKFLOWS, JSON.stringify(migrated));
  }
  return migrated;
}

export function getSdrWorkflow(id) {
  return getSdrWorkflows().find((w) => w.id === id) || null;
}

export function saveSdrWorkflow(workflow) {
  const list = getSdrWorkflows();
  const idx = list.findIndex((w) => w.id === workflow.id);
  if (idx >= 0) list[idx] = workflow; else list.push(workflow);
  localStorage.setItem(KEYS.SDR_WORKFLOWS, JSON.stringify(list));
  scheduleSync();
}

export function deleteSdrWorkflow(id) {
  const list = getSdrWorkflows().filter((w) => w.id !== id);
  localStorage.setItem(KEYS.SDR_WORKFLOWS, JSON.stringify(list));
  scheduleSync();
}
