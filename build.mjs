// Build: bun run build.mjs                  → Live-App (echte Daten, Sync)
//        FIN_ENV=test bun run build.mjs     → Test-App (eigene Daten, Beispieldaten, kein Sync)
// Erzeugt dist/ (bzw. FIN_OUT) zum Hosten auf GitHub Pages.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const ENV = process.env.FIN_ENV === 'test' ? 'test' : 'live';
const TEST = ENV === 'test';
const NAME = TEST ? 'Finanzen TEST' : 'Finanzen';
const out = process.env.FIN_OUT || 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const build = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const result = await Bun.build({
  entrypoints: ['src/main.ts'], target: 'browser', minify: true,
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify(build), __APP_ENV__: JSON.stringify(ENV) },
});
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
const js = await result.outputs[0].text();

for (const f of readdirSync('public')) cpSync(`public/${f}`, `${out}/${f}`);
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
if (TEST) Object.assign(manifest, { name: NAME, short_name: 'Finanzen T', theme_color: '#cb4b16' });
writeFileSync(`${out}/manifest.webmanifest`, JSON.stringify(manifest, null, 2));
writeFileSync(`${out}/app.js`, js);
writeFileSync(`${out}/styles.css`, readFileSync('src/styles.css', 'utf8'));
const shell = readFileSync('src/shell.html', 'utf8');

writeFileSync(`${out}/index.html`, `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${NAME}</title>
<meta name="description" content="Ausgaben taggen und auswerten. Alle Daten bleiben auf dem Gerät.">
<meta name="theme-color" content="#fdf6e3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#002b36" media="(prefers-color-scheme: dark)">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${shell}<script type="module" src="app.js"></script>
</body>
</html>
`);
console.log(`Fertig (${ENV}): ${out}/ Version ${pkg.version} (${(js.length / 1024).toFixed(1)} KB JavaScript), Build ${build}`);
