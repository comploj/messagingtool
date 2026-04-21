import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { processAuth, readStore, writeStore, processShare } from './server/state.js'

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function tokenOfRaw(req) {
  const h = req.headers?.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  return m ? m[1].trim() : null;
}

async function requireAuthRaw(req, res) {
  const ok = await processAuth(tokenOfRaw(req));
  if (!ok) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'invalid_token' }));
    return false;
  }
  return true;
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'leadhunt-dev-api',
      configureServer(server) {
        server.middlewares.use('/api/scrape', async (req, res) => {
          const url = new URL(req.url, 'http://localhost').searchParams.get('url');
          if (!url) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing url parameter' })); return; }
          try {
            const response = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
              },
              redirect: 'follow',
            });
            const html = await response.text();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ contents: html }));
          } catch (err) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: err.message }));
          }
        });

        server.middlewares.use('/api/share', async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
          // path like /api/share/:token — after `use` strips the mount, req.url is `/:token`
          const token = (req.url || '').split('?')[0].replace(/^\//, '').trim();
          const snap = await processShare(token);
          if (!snap) return sendJson(res, 404, { error: 'not_found' });
          sendJson(res, 200, snap);
        });

        server.middlewares.use('/api/auth', async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
          if (!(await requireAuthRaw(req, res))) return;
          sendJson(res, 200, { ok: true });
        });

        server.middlewares.use('/api/state', async (req, res) => {
          if (!(await requireAuthRaw(req, res))) return;
          if (req.method === 'GET') {
            sendJson(res, 200, await readStore());
            return;
          }
          if (req.method === 'PUT') {
            let body;
            try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
            const { baseVersion, state } = body || {};
            const current = await readStore();
            if (typeof baseVersion !== 'number' || baseVersion !== current.version) {
              return sendJson(res, 409, { error: 'version_conflict', current });
            }
            const next = {
              version: current.version + 1,
              projects: Array.isArray(state?.projects) ? state.projects : current.projects,
              customers: Array.isArray(state?.customers) ? state.customers : current.customers,
              promptOverrides: state?.promptOverrides ?? current.promptOverrides,
              customTokens: Array.isArray(state?.customTokens) ? state.customTokens : current.customTokens,
            };
            await writeStore(next);
            sendJson(res, 200, { ok: true, version: next.version });
            return;
          }
          sendJson(res, 405, { error: 'method_not_allowed' });
        });
      },
    },
  ],
})
