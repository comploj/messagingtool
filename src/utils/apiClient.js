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
