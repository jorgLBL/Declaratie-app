// Shared logic for the app (browser) and the agenda sync (Node):
// project codes, .ics parsing with repeating events, and reading a receipt's text.
(function (root) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ymdUTC = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  const fromDayNum = n => ymdUTC(new Date(n * 864e5));
  const addDays = (s, n) => fromDayNum(dayNum(s) + n);

  /* ---------- project codes: 4 letters + 4 digits ---------- */
  const CODE_RE = /\b([A-Za-z]{4})[-_]?(\d{4})\b/g;
  function findCodes(text) {
    const out = []; let m; CODE_RE.lastIndex = 0;
    while ((m = CODE_RE.exec(text || ''))) { const c = (m[1] + m[2]).toUpperCase(); if (!out.includes(c)) out.push(c); }
    return out;
  }

  /* ---------- .ics ---------- */
  // Times with a TZID are taken as wall-clock time (the agenda and the phone share a time zone);
  // UTC times ("Z") are converted to the local time of whoever runs this.
  function parseStamp(prop) {
    if (!prop) return null;
    const v = prop.value;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(v || '');
    if (!m) return null;
    if (!m[4]) return { d: `${m[1]}-${m[2]}-${m[3]}`, min: 0, allDay: true };
    if (m[7]) {
      const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
      return { d: ymd(dt), min: dt.getHours() * 60 + dt.getMinutes(), allDay: false };
    }
    return { d: `${m[1]}-${m[2]}-${m[3]}`, min: +m[4] * 60 + +m[5], allDay: false };
  }
  const hhmm = min => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function parseDuration(v) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v || '');
    if (!m) return null;
    return ((+m[2] || 0) * 7 * 1440 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0)) * (m[1] === '-' ? -1 : 1);
  }

  // Expands an RRULE into start dates (YYYY-MM-DD) between from and to. Supports
  // FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY (also 2MO / -1FR) and BYMONTHDAY.
  function expandRule(startDay, rule, from, to) {
    const r = {};
    for (const part of rule.split(';')) { const [k, v] = part.split('='); if (k) r[k.toUpperCase()] = v; }
    const freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1);
    const count = r.COUNT ? +r.COUNT : Infinity;
    const until = r.UNTIL ? (parseStamp({ value: r.UNTIL }) || {}).d : null;
    const byday = r.BYDAY ? r.BYDAY.split(',').map(x => { const mm = /^([+-]?\d+)?([A-Z]{2})$/.exec(x); return mm ? { n: mm[1] ? +mm[1] : 0, wd: WD[mm[2]] } : null; }).filter(Boolean) : [];
    const bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : [];
    const out = [];
    let n = 0;
    const s0 = dayNum(startDay);
    const sDate = new Date(s0 * 864e5);
    const accept = d => {
      if (d < startDay) return true;
      if (until && d > until) return false;
      if (n >= count) return false;
      n++;
      if (d >= from && d <= to) out.push(d);
      return true;
    };
    const lastDay = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const nthWeekday = (y, mo, wd, nth) => {
      const days = [];
      for (let d = 1; d <= lastDay(y, mo); d++) if (new Date(Date.UTC(y, mo, d)).getUTCDay() === wd) days.push(d);
      const d = nth > 0 ? days[nth - 1] : days[days.length + nth];
      return d ? ymdUTC(new Date(Date.UTC(y, mo, d))) : null;
    };
    const hardEnd = to < (until || to) ? to : (until || to);
    for (let i = 0; i < 5000; i++) {
      let cands = [];
      if (freq === 'DAILY') cands = [fromDayNum(s0 + i * interval)];
      else if (freq === 'WEEKLY') {
        const weekStart = s0 - ((sDate.getUTCDay() + 6) % 7) + i * 7 * interval; // monday of that week
        const wds = byday.length ? byday.map(b => b.wd) : [sDate.getUTCDay()];
        cands = wds.map(wd => fromDayNum(weekStart + ((wd + 6) % 7))).sort();
      } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
        const step = freq === 'MONTHLY' ? i * interval : i * interval * 12;
        const y = sDate.getUTCFullYear() + Math.floor((sDate.getUTCMonth() + step) / 12);
        const mo = (sDate.getUTCMonth() + step) % 12;
        if (byday.length) cands = byday.map(b => b.n ? nthWeekday(y, mo, b.wd, b.n) : null).filter(Boolean);
        else {
          const mds = bymd.length ? bymd : [sDate.getUTCDate()];
          cands = mds.map(md => { const L = lastDay(y, mo); const d = md < 0 ? L + md + 1 : md; return d >= 1 && d <= L ? ymdUTC(new Date(Date.UTC(y, mo, d))) : null; }).filter(Boolean);
        }
        cands.sort();
      } else return [startDay].filter(d => d >= from && d <= to);
      let stop = false;
      for (const d of cands) if (!accept(d)) { stop = true; break; }
      if (stop) break;
      if (cands.length && cands[cands.length - 1] > hardEnd) break;
    }
    return out;
  }

  function parseIcs(text, opts = {}) {
    const today = opts.today || ymd(new Date());
    const from = opts.from || addDays(today, -400);
    const to = opts.to || addDays(today, 120);
    const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const unesc = s => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
    const events = []; let ev = null, depth = 0;
    for (const raw of lines) {
      if (raw === 'BEGIN:VEVENT') { ev = { EXDATE: [] }; depth = 0; continue; }
      if (!ev) continue;
      if (raw.startsWith('BEGIN:')) { depth++; continue; } // e.g. VALARM inside an event
      if (raw.startsWith('END:') && raw !== 'END:VEVENT') { depth--; continue; }
      if (raw === 'END:VEVENT') { events.push(ev); ev = null; continue; }
      if (depth > 0) continue;
      const i = raw.indexOf(':'); if (i < 0) continue;
      const head = raw.slice(0, i).split(';'); const key = head[0].toUpperCase(); const value = raw.slice(i + 1);
      const params = {}; for (const p of head.slice(1)) { const [k, v] = p.split('='); params[(k || '').toUpperCase()] = v; }
      if (key === 'EXDATE') { for (const v of value.split(',')) ev.EXDATE.push({ value: v, params }); }
      else if (['SUMMARY', 'DESCRIPTION', 'LOCATION'].includes(key)) ev[key] = unesc(value);
      else if (['DTSTART', 'DTEND', 'RECURRENCE-ID'].includes(key)) ev[key] = { value, params };
      else if (['RRULE', 'DURATION', 'UID', 'STATUS'].includes(key)) ev[key] = value;
    }
    // occurrences moved or cancelled individually replace the matching occurrence of the series
    const overridden = new Map();
    for (const e of events) if (e['RECURRENCE-ID'] && e.UID) {
      const s = parseStamp(e['RECURRENCE-ID']); if (!s) continue;
      if (!overridden.has(e.UID)) overridden.set(e.UID, new Set());
      overridden.get(e.UID).add(s.d);
    }
    const out = [];
    for (const e of events) {
      if ((e.STATUS || '').toUpperCase() === 'CANCELLED') continue;
      const codes = findCodes([e.SUMMARY, e.DESCRIPTION, e.LOCATION].join(' '));
      if (!codes.length) continue;
      const s = parseStamp(e.DTSTART); if (!s) continue;
      const en = parseStamp(e.DTEND);
      let durMin = en ? (dayNum(en.d) - dayNum(s.d)) * 1440 + (en.min - s.min) : (parseDuration(e.DURATION) ?? (s.allDay ? 1440 : 0));
      if (durMin < 0) durMin = 0;
      const spanDays = s.allDay ? Math.max(0, Math.ceil(durMin / 1440) - 1) : Math.floor((s.min + Math.max(0, durMin - 1)) / 1440);
      let starts = e.RRULE && !e['RECURRENCE-ID'] ? expandRule(s.d, e.RRULE, addDays(from, -spanDays), to) : [s.d];
      const skip = new Set(e.EXDATE.map(x => (parseStamp(x) || {}).d));
      if (e.UID && overridden.has(e.UID) && !e['RECURRENCE-ID']) for (const d of overridden.get(e.UID)) skip.add(d);
      starts = starts.filter(d => !skip.has(d));
      const time = s.allDay ? 'hele dag' : `${hhmm(s.min)}–${hhmm(s.min + durMin)}`;
      for (const d of starts) {
        const end = addDays(d, spanDays);
        if (end < from || d > to) continue;
        for (const code of codes) out.push({ s: d, e: end, code, t: (e.SUMMARY || '').trim().slice(0, 120), time });
      }
    }
    out.sort((a, b) => a.s.localeCompare(b.s));
    return out.slice(-5000);
  }

  /* ---------- receipt text ---------- */
  const MONTHS = { jan: 1, feb: 2, mrt: 3, maa: 3, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12 };
  const BRANDS = [
    ['Albert Heijn', /\balbert\s*heijn\b|\bah\s*to\s*go\b/i], ['Jumbo', /\bjumbo\b/i], ['Lidl', /\blidl\b/i], ['Aldi', /\baldi\b/i],
    ['Plus', /\bplus\s+(supermarkt|[a-z]+\s*\d)/i], ['HEMA', /\bhema\b/i], ['Action', /\baction\b/i], ['Kruidvat', /\bkruidvat\b/i],
    ['NS', /\bns\b.*\b(reizigers|station|kaartje)|\bnsinternational|\bns\.nl\b/i], ['Q-Park', /\bq[\s-]?park\b/i],
    ['Interparking', /\binterparking\b/i], ['APCOA', /\bapcoa\b/i], ['Shell', /\bshell\b/i], ['BP', /\bbp\b/i], ['Esso', /\besso\b/i],
    ['TotalEnergies', /\btotal\s*energies\b/i], ['Tango', /\btango\b/i], ['Tinq', /\btinq\b/i], ['Texaco', /\btexaco\b/i],
    ['Gamma', /\bgamma\b/i], ['Praxis', /\bpraxis\b/i], ['Karwei', /\bkarwei\b/i], ['Hornbach', /\bhornbach\b/i], ['Hubo', /\bhubo\b/i],
    ['IKEA', /\bikea\b/i], ['Starbucks', /\bstarbucks\b/i], ["McDonald's", /\bmc\s*donald/i], ['Burger King', /\bburger\s*king\b/i],
    ['Bagels & Beans', /\bbagels\s*&?\s*beans\b/i], ['La Place', /\bla\s*place\b/i], ['Bruna', /\bbruna\b/i], ['Coolblue', /\bcoolblue\b/i],
  ];
  const KINDS = [
    ['Parkeren', 'Parkeren', /\bparke(er|ren)|\bparking\b|q[\s-]?park|interparking|apcoa|parkeerautomaat/i],
    ['Reiskosten', 'Brandstof', /\b(benzine|diesel|euro\s*95|e10|lpg|liter|ltr|pomp\s*\d|brandstof|shell|esso|tango|tinq|texaco)\b/i],
    ['Reiskosten', 'Openbaar vervoer', /\b(ns|ov[\s-]?chip|trein|treinkaartje|enkele\s*reis|retour|gvb|ret|htm|arriva|connexxion|qbuzz|keolis)\b/i],
    ['Reiskosten', 'Taxi', /\b(taxi|uber|bolt)\b/i],
    ['Verblijf', 'Hotelovernachting', /\b(hotel|overnachting|kamer\s*\d|logies|toeristenbelasting)\b/i],
    ['Maaltijd', 'Lunch', /\b(lunch|broodje|bagel|sandwich|tosti|soep|salade|menu|maaltijd|diner|restaurant|eetcafe|lunchroom)\b/i],
    ['Maaltijd', 'Koffie', /\b(koffie|cappuccino|latte|espresso|thee|americano)\b/i],
    ['Materiaal', 'Bouwmaterialen', /\b(gamma|praxis|karwei|hornbach|hubo|bouwmaat|schroeven|pluggen|hout|verf|kit)\b/i],
    ['Materiaal', 'Kantoorartikelen', /\b(bruna|kantoor|papier|pennen|printer|cartridge|toner|staples)\b/i],
  ];
  // OCR mixes up letters and digits; fix that only inside things that look like amounts.
  function cleanLine(l) {
    return l
      .replace(/(\d)\s*[,.]\s*([0-9OoSsIl]{2})(?![0-9])/g, (m, a, b) => a + ',' + b.replace(/[Oo]/g, '0').replace(/[Ss]/g, '5').replace(/[Il]/g, '1'))
      .replace(/€\s+/g, '€');
  }
  const AMOUNT_RE = /(?:€|eur\s?)?(-?\d{1,3}(?:[.\s]\d{3})*|-?\d+)[,.](\d{2})(?!\d)/gi;
  function amountsIn(line) {
    const out = []; let m; AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(line))) { const n = Number(m[1].replace(/[.\s]/g, '') + '.' + m[2]); if (isFinite(n) && n > 0 && n < 100000) out.push(n); }
    return out;
  }
  function validDate(y, mo, d, today) {
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null;
    const s = ymdUTC(dt);
    if (s > addDays(today, 1) || s < addDays(today, -800)) return null;
    return s;
  }
  function findDate(text, today) {
    const cands = [];
    let m;
    const re1 = /\b(\d{1,2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{4}|\d{2})\b/g;
    while ((m = re1.exec(text))) cands.push([m.index, validDate(+m[3], +m[2], +m[1], today)]);
    const re2 = /\b(20\d{2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})\b/g;
    while ((m = re2.exec(text))) cands.push([m.index, validDate(+m[1], +m[2], +m[3], today)]);
    const re3 = /\b(\d{1,2})\s*(jan|feb|mrt|maa|mar|apr|mei|may|jun|jul|aug|sep|okt|oct|nov|dec)[a-z]*\.?\s*('?\d{2,4})?/gi;
    while ((m = re3.exec(text))) {
      const y = m[3] ? +m[3].replace("'", '') : +today.slice(0, 4);
      cands.push([m.index, validDate(y, MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1], today)]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const ok = cands.filter(c => c[1]);
    return ok.length ? ok[0][1] : null;
  }
  function parseReceipt(text, today) {
    today = today || ymd(new Date());
    const lines = String(text || '').split('\n').map(l => cleanLine(l.trim())).filter(Boolean);
    const full = lines.join('\n');
    // total: the amount on the line with the strongest "total" keyword
    const KEY = [[/te\s*betalen|totaal\s*te\s*betalen|amount\s*due/i, 6], [/tota+l|\btotale\b|\btot\.?\b/i, 5],
      [/\bbetaald|\bbedrag\b|\bpin\b|pinnen|\bmaestro\b|v\s*pay|\bvisa\b|mastercard|\bdebit\b|contactloos|\bkaart\b/i, 3]];
    const BAD = /btw|b\.t\.w|vat|subtota|wisselgeld|terug|retour|contant\s*ontv|korting|statiegeld|excl|netto|saldo|spaar|punten|\d+\s*%/i;
    let best = null;
    lines.forEach((l, i) => {
      let score = 0; for (const [re, s] of KEY) if (re.test(l)) score = Math.max(score, s);
      if (!score || BAD.test(l)) return;
      let am = amountsIn(l);
      if (!am.length && lines[i + 1] && !BAD.test(lines[i + 1])) am = amountsIn(lines[i + 1]);
      if (!am.length) return;
      const v = am[am.length - 1];
      if (!best || score > best.score || (score === best.score && v > best.v)) best = { score, v };
    });
    let total = best ? best.v : null, confident = !!best;
    if (total == null) {
      const all = lines.filter(l => !BAD.test(l)).flatMap(amountsIn);
      if (all.length) total = Math.max(...all);
    }
    const date = findDate(full, today);
    let merchant = null;
    for (const [name, re] of BRANDS) if (re.test(full)) { merchant = name; break; }
    if (!merchant) {
      for (const l of lines.slice(0, 6)) {
        const t = l.replace(/[^A-Za-zÀ-ÿ&'.\- ]/g, ' ').replace(/\s+/g, ' ').trim();
        if (t.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3 && !/kassabon|bon\b|welkom|bedankt|datum|tijd|kassa|filiaal|tel\b|btw|www|http/i.test(t)) { merchant = t.slice(0, 40); break; }
      }
    }
    let category = 'Overig', description = '';
    for (const [cat, desc, re] of KINDS) if (re.test(full)) { category = cat; description = desc; break; }
    return { total, date, merchant, description, category, confident };
  }

  const api = { findCodes, parseIcs, parseReceipt, expandRule, addDays, ymd };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeclLib = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
