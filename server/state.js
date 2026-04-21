import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCESS_TOKENS } from './config.js';

const STORE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'store.json');

function emptyStore() {
  return {
    version: 0,
    projects: [],
    customers: [],
    promptOverrides: { strategies: {}, staticFollowups: {} },
    customTokens: [],
  };
}

function randomId() {
  try { return globalThis.crypto?.randomUUID?.() || ''; } catch {}
  return `cust-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// One-shot migration: synthesize customers from legacy project.clientName
// whenever a project is missing its customerId, and back-fill the FK on every
// such project. Runs on every read but is a no-op after the first write.
function migrateStore(store) {
  const projects = Array.isArray(store.projects) ? store.projects : [];
  let customers = Array.isArray(store.customers) ? store.customers : [];
  const allMigrated = customers.length > 0 && projects.every((p) => p.customerId);
  if (allMigrated) return { ...store, projects, customers };

  const byName = new Map();
  for (const c of customers) byName.set((c.name || '').trim() || 'Uncategorized', c);

  for (const p of projects) {
    const name = (p.clientName || '').trim() || 'Uncategorized';
    if (!byName.has(name)) {
      byName.set(name, {
        id: randomId() || `cust-${byName.size}-${Date.now()}`,
        name,
        website: '',
        createdAt: new Date().toISOString(),
      });
    }
    const cust = byName.get(name);
    if (!cust.website && p.clientWebsite) cust.website = p.clientWebsite;
  }

  customers = Array.from(byName.values());
  const nameToId = Object.fromEntries(customers.map((c) => [c.name, c.id]));

  const nextProjects = projects.map((p) => {
    if (p.customerId) return p;
    const name = (p.clientName || '').trim() || 'Uncategorized';
    return { ...p, customerId: nameToId[name] };
  });
  return { ...store, projects: nextProjects, customers };
}

export async function readStore() {
  let parsed;
  try {
    const raw = await readFile(STORE_FILE, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    return emptyStore();
  }
  const base = {
    version: Number(parsed.version) || 0,
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    customers: Array.isArray(parsed.customers) ? parsed.customers : [],
    promptOverrides: parsed.promptOverrides || { strategies: {}, staticFollowups: {} },
    customTokens: Array.isArray(parsed.customTokens) ? parsed.customTokens : [],
  };
  return migrateStore(base);
}

export async function writeStore(next) {
  await mkdir(dirname(STORE_FILE), { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(next, null, 2));
}

function tokenOf(req) {
  const h = req.headers?.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  return m ? m[1].trim() : null;
}

async function isValidToken(token) {
  if (!token) return false;
  if (ACCESS_TOKENS.includes(token)) return true;
  const store = await readStore();
  return (store.customTokens || []).includes(token);
}

// Express middleware
export async function requireAuth(req, res, next) {
  if (await isValidToken(tokenOf(req))) return next();
  res.status(401).json({ error: 'invalid_token' });
}

export async function handleAuth(_req, res) {
  res.json({ ok: true });
}

export async function handleGetState(_req, res) {
  res.json(await readStore());
}

export async function handlePutState(req, res) {
  const { baseVersion, state } = req.body || {};
  const current = await readStore();
  if (typeof baseVersion !== 'number' || baseVersion !== current.version) {
    return res.status(409).json({ error: 'version_conflict', current });
  }
  const next = {
    version: current.version + 1,
    projects: Array.isArray(state?.projects) ? state.projects : current.projects,
    customers: Array.isArray(state?.customers) ? state.customers : current.customers,
    promptOverrides: state?.promptOverrides ?? current.promptOverrides,
    customTokens: Array.isArray(state?.customTokens) ? state.customTokens : current.customTokens,
  };
  await writeStore(next);
  res.json({ ok: true, version: next.version });
}

// Public read-only share — no auth. Looks up a project by its shareToken
// and returns a minimal view-only projection with sequences + generated
// outputs + lead info. Viewers can see what the author generated but cannot
// see prompt templates, API keys, or any other project.
export async function handleGetShare(req, res) {
  const token = String(req.params?.token || '').trim();
  if (!token) return res.status(404).json({ error: 'not_found' });
  const store = await readStore();
  const project = (store.projects || []).find((p) => p.shareToken === token);
  if (!project) return res.status(404).json({ error: 'not_found' });
  const customer = (store.customers || []).find((c) => c.id === project.customerId);
  const snapshot = {
    projectName: project.name || '',
    customerName: customer?.name || project.clientName || '',
    language: project.language || 'en',
    sequences: (project.sequences || []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      messages: (s.messages || []).map((m) => ({
        id: m.id,
        label: m.label,
        type: m.type,
        delayDays: m.delayDays,
      })),
    })),
    outputs: project.outputs || {},
    lead: project.lead ? {
      firstName: project.lead.firstName || '',
      lastName: project.lead.lastName || '',
      position: project.lead.position || '',
      company: project.lead.company || '',
      companyWebsite: project.lead.companyWebsite || '',
    } : null,
  };
  res.json(snapshot);
}

// Framework-agnostic helpers used by the Vite dev middleware, which doesn't
// pass an Express req/res pair.
export async function processAuth(token) {
  return isValidToken(token);
}

// For Vite dev middleware to handle /api/share/:token without Express req/res
export async function processShare(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const store = await readStore();
  const project = (store.projects || []).find((p) => p.shareToken === t);
  if (!project) return null;
  const customer = (store.customers || []).find((c) => c.id === project.customerId);
  return {
    projectName: project.name || '',
    customerName: customer?.name || project.clientName || '',
    language: project.language || 'en',
    sequences: (project.sequences || []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      messages: (s.messages || []).map((m) => ({
        id: m.id,
        label: m.label,
        type: m.type,
        delayDays: m.delayDays,
      })),
    })),
    outputs: project.outputs || {},
    lead: project.lead ? {
      firstName: project.lead.firstName || '',
      lastName: project.lead.lastName || '',
      position: project.lead.position || '',
      company: project.lead.company || '',
      companyWebsite: project.lead.companyWebsite || '',
    } : null,
  };
}
