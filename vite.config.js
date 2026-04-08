import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'scrape-proxy',
      configureServer(server) {
        server.middlewares.use('/api/scrape', async (req, res) => {
          const url = new URL(req.url, 'http://localhost').searchParams.get('url');
          if (!url) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing url parameter' }));
            return;
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
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ contents: html }));
          } catch (err) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      },
    },
  ],
})
