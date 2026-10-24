// Platzhalter der Live-App bis zur ersten Freigabe. Wird beim Übernehmen von „test“ in „main“ ersetzt.
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.FIN_OUT || 'dist';
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/index.html`, `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Finanzen</title><meta name="robots" content="noindex"><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#fdf6e3;color:#073642;display:grid;place-items:center;min-height:100vh;padding:16px}@media(prefers-color-scheme:dark){body{background:#002b36;color:#eee8d5}}a{color:#268bd2}</style></head><body><main><h1>Finanzen</h1><p>Die Live-Version folgt nach der ersten Freigabe.</p><p><a href="test/">Zur Test-Version</a></p></main></body></html>`);
console.log('Platzhalter gebaut:', out);
