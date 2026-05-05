import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { requireAuth, handleAuth, handleGetState, handlePutState, handleGetShare, handleGetShareState, handlePutShareState, handleShareAi, handleCreateProjectShare, handleDeleteProjectShare } from './server/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const app = express();

app.use(express.json({ limit: '4mb' }));

// Shared-state endpoints (projects, prompt overrides, custom tokens)
app.get('/api/auth', requireAuth, handleAuth);
app.get('/api/state', requireAuth, handleGetState);
app.put('/api/state', requireAuth, handlePutState);

// Atomic share-token issuance for an owned project. Auth required.
app.post('/api/projects/:projectId/share', requireAuth, handleCreateProjectShare);
app.delete('/api/projects/:projectId/share', requireAuth, handleDeleteProjectShare);

// Public share endpoints — NO auth required. Token grants edit access to one project.
app.get('/api/share/:token/state', handleGetShareState);
app.put('/api/share/:token/state', handlePutShareState);
// Server-side AI proxy — share viewers never see the owner's Anthropic key.
app.post('/api/share/:token/ai', handleShareAi);
// Legacy read-only snapshot endpoint — kept for old /share/:token URLs.
app.get('/api/share/:token', handleGetShare);

// Scrape proxy endpoint
app.get('/api/scrape', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
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
    res.json({ contents: html });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Serve static files from the built frontend
app.use(express.static(join(__dirname, 'dist')));

// SPA fallback — serve index.html for all non-API routes
app.use((req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LeadHunt server running on port ${PORT}`);
});
