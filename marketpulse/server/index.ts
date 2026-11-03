import dotenv from 'dotenv';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, missingSetup } from './app.js';
import { loadConfig } from './config.js';

dotenv.config({ quiet: true } as Parameters<typeof dotenv.config>[0]);

// `npm run start:demo` passes --demo (works on Windows, macOS and Linux shells alike).
if (process.argv.includes('--demo')) process.env.MARKETPULSE_MODE = 'demo';
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
} else {
  console.warn('[marketpulse] dist/ not found — API only. Run "npm run build" to serve the dashboard here, or use "npm run dev".');
}

app.listen(cfg.port, () => {
  console.log(`[marketpulse] Open http://localhost:${cfg.port} (mode: ${cfg.mode})`);
  const missing = missingSetup(cfg);
  if (missing.length) {
    console.log('[marketpulse] Missing configuration (copy .env.example to .env or run "npm run setup"):');
    for (const m of missing) console.log(`  - ${m}`);
  }
});
