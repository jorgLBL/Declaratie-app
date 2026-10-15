/**
 * Declaratie-app: werkagenda doorgeven aan de app.
 *
 * Zet dit script in je WERK-Google-account (script.google.com). Het leest je agenda als jou
 * en geeft alleen afspraken door waarin een projectcode staat (4 letters + 4 cijfers).
 * Instellen: zie de handleiding (README) in het GitHub-project, kopje "Google-werkagenda".
 *
 * - Met de geheime sleutel (?key=...) geeft het de afspraken als JSON (voor de app) of als
 *   .ics (?format=ics, voor het bijwerken via GitHub).
 * - Met de sleutel zet het ook een declaratie-mail met bijlage klaar als concept in je Gmail
 *   (alleen een concept: versturen doe je zelf in Gmail).
 * - Zonder sleutel toont het alleen aan jou een pagina met je app-link en een agenda-code.
 */

var DAYS_BACK = 400;   // zo ver terug kunnen bonnen gaan
var DAYS_AHEAD = 120;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.key) {
    if (p.key !== getKey_()) return json_({ error: 'key' });
    var data = collect_();
    if (p.format === 'ics') return ContentService.createTextOutput(toIcs_(data.events)).setMimeType(ContentService.MimeType.ICAL);
    return json_(data);
  }
  var me = Session.getEffectiveUser().getEmail();
  var viewer = Session.getActiveUser().getEmail();
  if (!viewer || viewer.toLowerCase() !== me.toLowerCase()) {
    return HtmlService.createHtmlOutput('<p style="font:16px sans-serif">Geen toegang.</p>');
  }
  return setupPage_();
}

var MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.key !== getKey_()) return json_({ error: 'key' });
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'request' }); }
  if (req.action !== 'draft') return json_({ error: 'request' });
  var to = String(req.to || '').trim();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return json_({ error: 'to' });
  try {
    var total = 0;
    var blobs = (req.attachments || []).slice(0, 10).map(function (a) {
      var bytes = Utilities.base64Decode(a.data);
      total += bytes.length;
      return Utilities.newBlob(bytes, a.type || 'application/octet-stream', String(a.name || 'bijlage'));
    });
    if (total > MAX_ATTACHMENT_BYTES) return json_({ error: 'size' });
    var options = { attachments: blobs };
    if (req.name) options.name = String(req.name).slice(0, 80);
    var draft = GmailApp.createDraft(to, String(req.subject || '').slice(0, 250), String(req.body || ''), options);
    return json_({ ok: true, id: draft.getId(), messageId: draft.getMessage().getId(), account: Session.getEffectiveUser().getEmail() });
  } catch (err) {
    return json_({ error: 'gmail', message: String(err && err.message || err) });
  }
}

/** Voer deze functie één keer uit in de editor om toegang tot je agenda te geven en de werking te testen. */
function test() {
  var data = collect_();
  Logger.log(data.events.length + ' afspraken met projectcode gevonden. Voorbeeld: ' + JSON.stringify(data.events.slice(0, 3)));
  Logger.log('Gmail: ' + GmailApp.getDrafts().length + ' concepten. Mails worden klaargezet vanaf ' + Session.getEffectiveUser().getEmail() + '.');
}

function getKey_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('KEY', key);
  }
  return key;
}

function findCodes_(text) {
  var re = /\b([A-Za-z]{4})[-_]?(\d{4})\b/g, out = [], m;
  while ((m = re.exec(text || ''))) {
    var c = (m[1] + m[2]).toUpperCase();
    if (out.indexOf(c) < 0) out.push(c);
  }
  return out;
}

function collect_() {
  var cal = CalendarApp.getDefaultCalendar();
  var tz = cal.getTimeZone() || Session.getScriptTimeZone();
  var now = new Date();
  var from = new Date(now.getTime() - DAYS_BACK * 864e5), to = new Date(now.getTime() + DAYS_AHEAD * 864e5);
  var fmt = function (d, f) { return Utilities.formatDate(d, tz, f); };
  var events = [];
  cal.getEvents(from, to).forEach(function (ev) {
    try { if (ev.getMyStatus && ev.getMyStatus() === CalendarApp.GuestStatus.NO) return; } catch (err) {}
    var title = ev.getTitle() || '';
    var codes = findCodes_([title, ev.getDescription(), ev.getLocation()].join(' '));
    if (!codes.length) return;
    var allDay = ev.isAllDayEvent();
    var start = ev.getStartTime(), end = ev.getEndTime();
    var last = new Date(Math.max(start.getTime(), end.getTime() - (allDay ? 864e5 : 60e3)));
    var item = {
      s: fmt(start, 'yyyy-MM-dd'),
      e: fmt(last, 'yyyy-MM-dd'),
      t: title.slice(0, 120),
      time: allDay ? 'hele dag' : fmt(start, 'HH:mm') + '–' + fmt(end, 'HH:mm'),
    };
    codes.forEach(function (code) { events.push({ s: item.s, e: item.e, code: code, t: item.t, time: item.time }); });
  });
  return { updated: fmt(now, "yyyy-MM-dd'T'HH:mm"), tz: tz, account: Session.getEffectiveUser().getEmail(), events: events };
}

function toIcs_(events) {
  var esc = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n'); };
  var d = function (s) { return s.replace(/-/g, ''); };
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Declaratie-app//Apps Script//NL'];
  events.forEach(function (ev, i) {
    lines.push('BEGIN:VEVENT', 'UID:decl-' + i + '-' + d(ev.s) + '-' + ev.code);
    if (ev.time === 'hele dag') {
      var endDay = new Date(Date.UTC(+ev.e.slice(0, 4), +ev.e.slice(5, 7) - 1, +ev.e.slice(8, 10) + 1));
      lines.push('DTSTART;VALUE=DATE:' + d(ev.s), 'DTEND;VALUE=DATE:' + Utilities.formatDate(endDay, 'UTC', 'yyyyMMdd'));
    } else {
      var t = ev.time.split('–');
      lines.push('DTSTART;TZID=Local:' + d(ev.s) + 'T' + t[0].replace(':', '') + '00', 'DTEND;TZID=Local:' + d(ev.e) + 'T' + t[1].replace(':', '') + '00');
    }
    lines.push('SUMMARY:' + esc(ev.t + (ev.t.toUpperCase().indexOf(ev.code) < 0 ? ' ' + ev.code : '')), 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function setupPage_() {
  var link = ScriptApp.getService().getUrl() + '?key=' + getKey_();
  var data = collect_();
  var code = 'DECL1:' + Utilities.base64Encode(JSON.stringify(data), Utilities.Charset.UTF_8);
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
  var html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:16px -apple-system,system-ui,sans-serif;margin:0;padding:20px;color:#12151C;background:#F1F3F6}' +
    'h1{font-size:24px;margin:0 0 6px}h2{font-size:17px;margin:22px 0 6px}p{color:#5E6574;margin:4px 0 10px}' +
    'textarea{width:100%;box-sizing:border-box;font:13px ui-monospace,Menlo,monospace;border:1px solid #E1E4EA;border-radius:10px;padding:10px;background:#fff}' +
    'button{font:600 16px -apple-system,system-ui,sans-serif;background:#2346D6;color:#fff;border:0;border-radius:12px;padding:12px 18px;margin-top:8px;width:100%}' +
    '.ok{color:#0F7F57;font-weight:600;min-height:1.4em}</style>' +
    '<h1>Werkagenda voor de Declaratie-app</h1>' +
    '<p>' + data.events.length + ' afspraken met projectcode gevonden (' + new Set(data.events.map(function (e) { return e.code; })).size + ' projecten).</p>' +
    '<h2>1. Koppeling (aanbevolen)</h2><p>Kopieer deze link en plak hem in de app bij Instellingen → Google-werkaccount → Koppeling. Daarmee zet de app mails klaar in Gmail en leest hij je agenda. Deel hem met niemand.</p>' +
    '<textarea id="l" rows="4" readonly>' + esc(link) + '</textarea><button onclick="cp(\'l\')">Kopieer link</button>' +
    '<h2>2. Werkt de link niet?</h2><p>Kopieer dan voor je agenda deze agenda-code en plak hem in de app bij Werkagenda → Google (werk) → agenda-code. Herhaal dit af en toe om je agenda bij te werken.</p>' +
    '<textarea id="c" rows="4" readonly>' + esc(code) + '</textarea><button onclick="cp(\'c\')">Kopieer agenda-code</button>' +
    '<p class="ok" id="m"></p>' +
    '<script>function cp(id){var t=document.getElementById(id);t.focus();t.select();t.setSelectionRange(0,t.value.length);' +
    'var done=function(){document.getElementById("m").textContent="Gekopieerd. Plak het in de app."};' +
    'try{navigator.clipboard.writeText(t.value).then(done,function(){document.execCommand("copy");done();})}catch(e){document.execCommand("copy");done();}}</script>';
  return HtmlService.createHtmlOutput(html).setTitle('Werkagenda – Declaratie-app').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
