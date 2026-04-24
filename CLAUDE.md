# Project context for Claude Code

This file is auto-loaded at the start of every Claude Code session in this
repo. It tells Claude how to behave on this project.

## Design system — READ BEFORE TOUCHING ANY UI

All visual work must follow **[docs/Leadhunt_Design_System.md](docs/Leadhunt_Design_System.md)**
exactly. Key constraints:

- Dark theme only. Primary bg `#0a0a0f`, secondary `#12121f`.
- Fonts: DM Sans (UI), Space Mono (logs/code only). 3 sizes max per view.
- Primary accent `#6366f1` → hover `#8b5cf6`. Gradient allowed only for
  primary buttons: `linear-gradient(135deg, #6366f1, #8b5cf6)`.
- Labels / section headers: 11px UPPERCASE, `0.05em` letter-spacing, `#64748b`.
- Body: 13-14px, `#e2e8f0`. Never below 12px.
- Spacing is 4px base scale (4/8/12/16/20/24/32/48).
- Border-radius: ≤12px on any container. Pills at 999px for tags only.
- Icons: Lucide React only. 16px default.
- British English in copy. No exclamation marks. No emojis in UI chrome.
- No confirm() / alert() — use inline confirmation with explicit buttons.
- Toasts: bottom-right, 3-5s auto-dismiss.
- Section 11 of the design system lists hard "never do this" rules — honour them.

If a request conflicts with the design system, flag it and ask rather
than silently breaking the system.

## Brand assets

- **Logo avatar video**: [public/logo-avatar.mp4](public/logo-avatar.mp4).
  The "AI" monogram animated. Use it on login / splash / loading screens
  where a brand moment is warranted, not as constant UI chrome.

## How this codebase is wired (short version)

- Stack: Vite + React 19, Express static server (`server.js`), single-file
  JSON store (`data/store.json`, gitignored) hit via `/api/state` with
  bearer-token auth. Vite dev middleware and Express share handlers from
  `server/state.js`.
- Client reads/writes go to `localStorage` (sync API kept for simplicity)
  and `scheduleSync()` in `src/utils/storage.js` debounces a whole-blob
  PUT to the server. On 409, the client re-hydrates.
- Deploy: push to `master` triggers `.github/workflows/deploy.yml`,
  which SSHes into the VPS and runs
  `git fetch && git reset --hard origin/master && npm ci && npm run build
  && systemctl restart messaging.service`.
- Access tokens are server-side in `server/config.js`. Client mirrors
  them in `src/config.js` for the login hint list only.
- Routing in `App.jsx` is a 4-state machine: `projects | customer | project | settings`.
  A `/share/:token` URL renders `ShareProjectView` without login.

## Working rules for this repo

- **After any task, commit and push** (auto-deploys). This is the user's
  standing preference.
- Prefer small, targeted diffs over wide refactors. When in doubt, ask
  before touching code outside the feature's critical path.
- Don't add dependencies without flagging it.
- When editing persisted data shape, mirror the migration on both
  `server/state.js` and the client's `storage.js` — same pattern as the
  existing `customerId` backfill.
- The server is authoritative. localStorage is a cache.
- Per-user secrets (Anthropic API key) stay client-side. Shared data
  (projects, customers, prompt overrides, custom tokens) goes through
  the server.

---

# Leadhunt Internal Tools — Design System (canonical)

The full document lives at [docs/Leadhunt_Design_System.md](docs/Leadhunt_Design_System.md).
Do not duplicate its content here — read that file when you need the
details (colours, typography, component specs, writing rules).
