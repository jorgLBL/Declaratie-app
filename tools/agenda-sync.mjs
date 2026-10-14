// Fetches the work agenda (.ics link), keeps only appointments with a project code and writes them
// encrypted with AGENDA_PASSWORD, so the public web app can read them and nobody else can.
// Usage: AGENDA_ICS_URL=<link or file> AGENDA_PASSWORD=<password> node tools/agenda-sync.mjs <output file>
import fs from 'fs';
import { createRequire } from 'module';
import { webcrypto as crypto } from 'crypto';

const require = createRequire(import.meta.url);
const L = require('../src/lib.js');
const src = (process.env.AGENDA_ICS_URL || '').trim().replace(/^webcal:\/\//i, 'https://');
const pass = process.env.AGENDA_PASSWORD || '';
const out = process.argv[2] || 'agenda.enc';
if (!src || !pass) { console.error('AGENDA_ICS_URL en AGENDA_PASSWORD zijn nodig.'); process.exit(1); }

let text;
if (/^https?:\/\//i.test(src)) {
  const res = await fetch(src, { headers: { 'user-agent': 'declaratie-app agenda-sync' } });
  if (!res.ok) { console.error(`Agenda ophalen mislukt: HTTP ${res.status}`); process.exit(1); }
  text = await res.text();
} else text = fs.readFileSync(src, 'utf8');
if (!/BEGIN:VCALENDAR/.test(text)) { console.error('Dit is geen agenda (.ics). Controleer de link.'); process.exit(1); }

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const updated = `${L.ymd(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
const events = L.parseIcs(text, { today: L.ymd(now) });
const plain = new TextEncoder().encode(JSON.stringify({ updated, events }));

const iter = 210000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
const b64 = u => Buffer.from(u).toString('base64');
fs.writeFileSync(out, JSON.stringify({ v: 1, iter, salt: b64(salt), iv: b64(iv), data: b64(data) }));
console.log(`${events.length} afspraken met projectcode (${new Set(events.map(e => e.code)).size} projecten) versleuteld naar ${out}`);
