// Thin client for the shared-state backend (server/state.js).
// Reads the access token from localStorage via getAuth() for the bearer header.
import { getAuth } from './storage';

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token ?? getAuth() ?? ''}`,
  };
}

export async function validateToken(token) {
  try {
    const res = await fetch('/api/auth', { headers: authHeaders(token) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchState() {
  const res = await fetch('/api/state', { headers: authHeaders() });
  if (!res.ok) throw new Error('fetch_state_failed_' + res.status);
  return res.json();
}

// Public read-only share snapshot (legacy) — no auth header.
export async function fetchShare(token) {
  const res = await fetch('/api/share/' + encodeURIComponent(token));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('fetch_share_failed_' + res.status);
  return res.json();
}

// Editable share state — returns { project, customer, promptOverrides, version }.
// No auth header; the token grants access to one specific project.
export async function fetchShareState(token) {
  const res = await fetch('/api/share/' + encodeURIComponent(token) + '/state');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('fetch_share_state_failed_' + res.status);
  return res.json();
}

// Forward an AI request through the share-token proxy. The owner's key
// stays on the server; the share viewer never sees it.
// `body` matches the Anthropic /v1/messages payload: { messages, max_tokens, tools? }.
// Throws an Error tagged with .ownerNoKey when the owner has not configured a key.
export async function callShareAi(token, body) {
  const res = await fetch('/api/share/' + encodeURIComponent(token) + '/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 503) {
    const err = new Error('owner_no_key');
    err.ownerNoKey = true;
    throw err;
  }
  if (res.status === 404) throw new Error('share_not_found');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

// Atomically issue a new share token for an owned project. Server-side
// mutation under a single read/write — no client-side race.
// Returns { token, version } on success. Throws on auth/network failure.
export async function createProjectShare(projectId) {
  const res = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/share', {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('create_share_failed_' + res.status);
  return res.json();
}

export async function deleteProjectShare(projectId) {
  const res = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/share', {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('delete_share_failed_' + res.status);
  return res.json();
}

// Push a project update under a share token.
// Returns { ok, version } on success or { conflict, current } on 409.
export async function pushShareState(token, project, baseVersion) {
  const res = await fetch('/api/share/' + encodeURIComponent(token) + '/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, baseVersion }),
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    return { conflict: true, current: body.current };
  }
  if (res.status === 403) {
    return { forbidden: true };
  }
  if (!res.ok) throw new Error('push_share_state_failed_' + res.status);
  return res.json();
}

// Returns one of:
//   { ok: true, version }
//   { conflict: true, current }  — caller should hydrate to `current`
// Throws on network / 5xx / auth failure.
export async function pushState(state, baseVersion) {
  const res = await fetch('/api/state', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ state, baseVersion }),
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    return { conflict: true, current: body.current };
  }
  if (!res.ok) throw new Error('push_state_failed_' + res.status);
  return res.json();
}
