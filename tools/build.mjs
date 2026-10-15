// Builds both versions from src/:
//   dist/artifact.html  the page published as a Claude artifact (Claude reads receipts, Google Agenda, cloud storage)
//   site/               the free web app for the iPhone home screen (reads receipts on the phone, works offline)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('src/app.html').replace('/*@LIB@*/', () => read('src/lib.js'));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/artifact.html'), app);

const site = path.join(root, 'site');
fs.rmSync(site, { recursive: true, force: true });
fs.cpSync(path.join(root, 'web'), site, { recursive: true });
fs.rmSync(path.join(site, 'sw.js'));

const head = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Declaraties">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#F1F3F6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D0F14" media="(prefers-color-scheme: dark)">
<meta name="robots" content="noindex">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="icon" href="icons/icon-192.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<script>window.DECL_WEB = true;</script>
</head>
<body>
`;
const tail = `
<script>
if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) navigator.serviceWorker.register('sw.js').catch(() => {});
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(site, 'index.html'), head + app + tail);

// app password (GitHub secret APP_PASSWORD): only a salted PBKDF2 hash goes into the public site
if (process.env.APP_PASSWORD) {
  const iter = 310000, salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(process.env.APP_PASSWORD, salt, iter, 32, 'sha256');
  fs.writeFileSync(path.join(site, 'lock.json'), JSON.stringify({ v: 1, iter, salt: salt.toString('base64'), hash: hash.toString('base64') }));
}

// service worker: version = hash of everything it caches, so a new build replaces the old cache
const files = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(site, p).split(path.sep).join('/')); } };
walk(site);
const hash = crypto.createHash('sha256');
for (const f of files.sort()) hash.update(f).update(fs.readFileSync(path.join(site, f)));
const sw = read('web/sw.js')
  .replace('__VERSION__', hash.digest('hex').slice(0, 12))
  .replace('__FILES__', JSON.stringify(files.filter(f => !/LICENSE|\.md$/.test(f))));
fs.writeFileSync(path.join(site, 'sw.js'), sw);
fs.writeFileSync(path.join(site, '.nojekyll'), '');
console.log(`dist/artifact.html (${(app.length / 1024).toFixed(0)} kB) en site/ (${files.length + 1} bestanden) gebouwd${process.env.APP_PASSWORD ? ', met wachtwoord' : ', zonder wachtwoord'}`);
