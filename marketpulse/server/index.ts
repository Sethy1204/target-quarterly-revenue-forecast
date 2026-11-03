import dotenv from 'dotenv';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, missingSetup } from './app.js';
import { loadConfig } from './config.js';

dotenv.config({ quiet: true } as Parameters<typeof dotenv.config>[0]);

const cfg = loadConfig();
const app = createApp({ cfg });

// In production, serve the built React app from dist/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
if (existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[marketpulse] dist/ not found — run "npm run build" first.');
}

app.listen(cfg.port, () => {
  console.log(`[marketpulse] API listening on http://localhost:${cfg.port} (mode: ${cfg.mode})`);
  const missing = missingSetup(cfg);
  if (missing.length) {
    console.log('[marketpulse] Missing configuration (copy .env.example to .env or run "npm run setup"):');
    for (const m of missing) console.log(`  - ${m}`);
  }
});
