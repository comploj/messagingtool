import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCESS_TOKENS } from './config.js';

const STORE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'store.json');

function emptyStore() {
  return {
    version: 0,
    projects: [],
    promptOverrides: { strategies: {}, staticFollowups: {} },
    customTokens: [],
  };
}

export async function readStore() {
  try {
    const raw = await readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: Number(parsed.version) || 0,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      promptOverrides: parsed.promptOverrides || { strategies: {}, staticFollowups: {} },
      customTokens: Array.isArray(parsed.customTokens) ? parsed.customTokens : [],
    };
  } catch {
    return emptyStore();
  }
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
    promptOverrides: state?.promptOverrides ?? current.promptOverrides,
    customTokens: Array.isArray(state?.customTokens) ? state.customTokens : current.customTokens,
  };
  await writeStore(next);
  res.json({ ok: true, version: next.version });
}

// Framework-agnostic helpers used by the Vite dev middleware, which doesn't
// pass an Express req/res pair.
export async function processAuth(token) {
  return isValidToken(token);
}
