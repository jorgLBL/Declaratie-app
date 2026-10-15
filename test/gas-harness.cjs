// Runs tools/apps-script/Code.gs with stand-ins for Google's services (used by the tests).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TZ = 'Europe/Amsterdam';
const fmtParts = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
const formatDate = (d, tz, f) => { const p = fmtParts(d, tz); return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace(/'/g, ''); };
const at = (s) => new Date(s); // ISO with offset
const ev = (title, start, end, o = {}) => ({
  getTitle: () => title, getDescription: () => o.desc || '', getLocation: () => o.loc || '',
  isAllDayEvent: () => !!o.allDay, getStartTime: () => at(start), getEndTime: () => at(end),
  getMyStatus: () => o.status || 'YES',
});
const EVENTS = [
  ev('Ontwerpsessie KLMN2041 bij klant', '2026-10-08T10:00:00+02:00', '2026-10-08T13:00:00+02:00'),
  ev('Boulderen', '2026-10-08T20:30:00+02:00', '2026-10-08T22:00:00+02:00'),
  ev('Bouwvergadering', '2026-10-09T09:00:00+02:00', '2026-10-09T10:00:00+02:00', { desc: 'Project RTSV-3310 fase 2' }),
  ev('Locatiebezoek ABCD1234', '2026-10-12T00:00:00+02:00', '2026-10-15T00:00:00+02:00', { allDay: true }),
  ev('Afgeslagen PQRS5555', '2026-10-09T14:00:00+02:00', '2026-10-09T15:00:00+02:00', { status: 'NO' }),
  ev('Nachtdienst WXYZ1111', '2026-10-10T22:00:00+02:00', '2026-10-11T02:00:00+02:00'),
];
function run(viewer) {
  const props = {};
  const out = { drafts: [] };
  const ctx = {
    CalendarApp: { GuestStatus: { NO: 'NO' }, getDefaultCalendar: () => ({ getTimeZone: () => TZ, getEvents: () => EVENTS }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'jorg@werk.nl' }), getActiveUser: () => ({ getEmail: () => viewer }), getScriptTimeZone: () => TZ },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    Utilities: {
      getUuid: () => require('crypto').randomUUID(), formatDate, Charset: { UTF_8: 'UTF-8' },
      base64Encode: s => Buffer.from(s, 'utf8').toString('base64'),
      base64Decode: s => [...Buffer.from(s, 'base64')],
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
    },
    GmailApp: {
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
    Logger: { log: m => { out.log = m; } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../tools/apps-script/Code.gs'), 'utf8'), ctx);
  return { ctx, props, out };
}

module.exports = { run };
