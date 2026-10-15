// Runs tools/apps-script/Code.gs with stand-ins for Google's services (used by the tests).
// run(viewer, { api }) — api: true also offers the "Google Calendar API" service (the fast path).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TZ = 'Europe/Amsterdam';
const fmtParts = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
const formatDate = (d, tz, f) => { const p = fmtParts(d, tz); return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace(/'/g, ''); };

// one list of appointments, served both as CalendarApp events and as Calendar API items
const RAW = [
  { title: 'Ontwerpsessie KLMN2041 bij klant', start: '2026-10-08T10:00:00+02:00', end: '2026-10-08T13:00:00+02:00' },
  { title: 'Boulderen', start: '2026-10-08T20:30:00+02:00', end: '2026-10-08T22:00:00+02:00' },
  { title: 'Bouwvergadering', start: '2026-10-09T09:00:00+02:00', end: '2026-10-09T10:00:00+02:00', desc: 'Project RTSV-3310 fase 2' },
  { title: 'Locatiebezoek ABCD1234', day: '2026-10-12', endDay: '2026-10-15' },
  { title: 'Afgeslagen PQRS5555', start: '2026-10-09T14:00:00+02:00', end: '2026-10-09T15:00:00+02:00', declined: true },
  { title: 'Nachtdienst WXYZ1111', start: '2026-10-10T22:00:00+02:00', end: '2026-10-11T02:00:00+02:00' },
  { title: 'Geannuleerd ZZZZ9999', start: '2026-10-09T08:00:00+02:00', end: '2026-10-09T09:00:00+02:00', cancelled: true },
];

// a small Google Drive: folders with files (text or bytes), trash, lookup by name
function driveStub(d) {
  let n = 0;
  const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const fileObj = f => ({
    getId: () => f.id, getName: () => f.name,
    getBlob: () => ({ getDataAsString: () => Buffer.from(f.bytes).toString('utf8'), getBytes: () => [...f.bytes], getContentType: () => f.type }),
    setContent: c => { if (d.failWrites) throw new Error('Drive is niet toegestaan'); f.bytes = Buffer.from(c, 'utf8'); },
    setTrashed: t => { f.trashed = t; },
  });
  const folderObj = fo => ({
    getId: () => fo.id, isTrashed: () => !!fo.trashed,
    getFilesByName: name => iter(d.files.filter(f => f.folder === fo.id && f.name === name && !f.trashed).map(fileObj)),
    createFile: (a, content, type) => {
      if (d.failWrites) throw new Error('Drive is niet toegestaan');
      const f = typeof a === 'string'
        ? { id: 'f' + ++n, folder: fo.id, name: a, type, bytes: Buffer.from(content, 'utf8') }
        : { id: 'f' + ++n, folder: fo.id, name: a.name, type: a.type, bytes: Buffer.from(a.bytes) };
      d.files.push(f);
      return fileObj(f);
    },
  });
  return {
    createFolder: name => { const fo = { id: 'd' + ++n, name }; d.folders.push(fo); return folderObj(fo); },
    getFolderById: id => { const fo = d.folders.find(x => x.id === id); if (!fo) throw new Error('niet gevonden'); return folderObj(fo); },
  };
}

function run(viewer, opts = {}) {
  const props = {};
  const cache = {};
  const out = { drafts: [], calls: 0, apiCalls: 0, logs: [], drive: { folders: [], files: [] } };
  const counted = fn => (...a) => { out.calls++; return fn(...a); };
  const appEvents = () => RAW.filter(r => !r.cancelled).map(r => ({
    getTitle: counted(() => r.title), getDescription: counted(() => r.desc || ''), getLocation: counted(() => ''),
    isAllDayEvent: counted(() => !!r.day),
    getStartTime: counted(() => new Date(r.day ? r.day + 'T00:00:00+02:00' : r.start)),
    getEndTime: counted(() => new Date(r.endDay ? r.endDay + 'T00:00:00+02:00' : r.end)),
    getMyStatus: counted(() => (r.declined ? 'NO' : 'YES')),
  }));
  const apiItems = () => RAW.map(r => ({
    summary: r.title, description: r.desc, status: r.cancelled ? 'cancelled' : 'confirmed',
    start: r.day ? { date: r.day } : { dateTime: r.start }, end: r.endDay ? { date: r.endDay } : { dateTime: r.end },
    attendees: r.declined ? [{ self: true, responseStatus: 'declined' }] : undefined,
  }));
  const ctx = {
    CalendarApp: { GuestStatus: { NO: 'NO' }, getDefaultCalendar: () => ({ getTimeZone: () => TZ, getEvents: () => { out.apiCalls++; return appEvents(); } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'jorg@werk.nl' }), getActiveUser: () => ({ getEmail: () => viewer }), getScriptTimeZone: () => TZ },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) },
    Utilities: {
      getUuid: () => require('crypto').randomUUID(), formatDate, Charset: { UTF_8: 'UTF-8' },
      base64Encode: v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v)).toString('base64'),
      base64Decode: s => [...Buffer.from(s, 'base64')],
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
    },
    GmailApp: {
      getAliases: () => [],
      getDrafts: () => out.drafts,
      createDraft: (to, subject, body, options) => {
        if (out.gmailFails) throw new Error('Gmail is niet toegestaan');
        const d = { to, subject, body, options, id: 'r-' + (out.drafts.length + 1) };
        out.drafts.push(d);
        return { getId: () => d.id, getMessage: () => ({ getId: () => '18f' + out.drafts.length }) };
      },
    },
    ContentService: { MimeType: { JSON: 'json', ICAL: 'ical' }, createTextOutput: t => ({ text: t, setMimeType(m) { this.mime = m; return this; } }) },
    HtmlService: { createHtmlOutput: h => ({ html: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ABC/exec' }) },
    Logger: { log: m => { out.logs.push(m); out.log = m; } },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    DriveApp: driveStub(out.drive),
  };
  if (opts.api) {
    ctx.Calendar = {
      Calendars: { get: () => ({ timeZone: TZ }) },
      Events: {
        list: (id, q) => {
          out.apiCalls++;
          out.lastQuery = q;
          const items = apiItems();
          const page = q.pageToken ? 1 : 0;           // two pages, to exercise paging
          return page === 0 ? { items: items.slice(0, 3), nextPageToken: 'p2' } : { items: items.slice(3) };
        },
      },
    };
  }
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../tools/apps-script/Code.gs'), 'utf8'), ctx);
  return { ctx, props, out, cache };
}

module.exports = { run };
