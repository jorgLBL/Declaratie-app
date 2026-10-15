/**
 * Declaratie-app: declaraties klaarzetten in Gmail en de werkagenda doorgeven aan de app.
 *
 * Zet dit script in je WERK-Google-account (script.google.com). Het leest je agenda als jou
 * en geeft alleen afspraken door waarin een projectcode staat (4 letters + 4 cijfers).
 * Instellen: zie de handleiding (README) in het GitHub-project, kopje "Google-werkaccount koppelen".
 *
 * - Met de geheime sleutel (?key=...) geeft het de afspraken als JSON (voor de app) of als
 *   .ics (?format=ics, voor het bijwerken via GitHub).
 * - Met de sleutel zet het ook een declaratie-mail met bijlage klaar als concept in je Gmail
 *   (alleen een concept: versturen doe je zelf in Gmail).
 * - Zonder sleutel toont het alleen aan jou een pagina met je app-link en een agenda-code.
 */

var DAYS_BACK = 400;   // zo ver terug kunnen bonnen gaan
var DAYS_AHEAD = 120;
var DAYS_BACK_SLOW = 90; // zonder de dienst "Google Calendar API" is elke afspraak een losse, trage aanvraag
var CACHE_SECONDS = 600; // de app vraagt de agenda vaak op; 10 minuten hetzelfde antwoord is snel genoeg

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

/**
 * Voer deze functie één keer uit in de editor: geeft toegang tot agenda en Gmail en test de werking.
 * Het resultaat staat daarna in het uitvoeringslogboek.
 */
function test() {
  var t0 = Date.now();
  var data = collect_(true);
  Logger.log(data.events.length + ' afspraken met projectcode gevonden in ' + Math.round((Date.now() - t0) / 1000) + ' s (' +
    (data.via === 'api' ? 'snel, via Google Calendar API' : 'traag; voeg de dienst Google Calendar API toe, zie de handleiding') + ').');
  Logger.log('Voorbeeld: ' + JSON.stringify(data.events.slice(0, 3)));
  Logger.log('Gmail: concepten worden klaargezet vanaf ' + Session.getEffectiveUser().getEmail() + ' (adressen: ' + GmailApp.getAliases().concat([Session.getEffectiveUser().getEmail()]).join(', ') + ').');
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

function collect_(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var hit = cache.get('agenda');
    if (hit) return JSON.parse(hit);
  }
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var fmt = function (d, f) { return Utilities.formatDate(d, tz, f); };
  var events = [];
  var add = function (codes, title, s, e, time) {
    codes.forEach(function (code) { events.push({ s: s, e: e < s ? s : e, code: code, t: String(title || '').slice(0, 120), time: time }); });
  };
  var via;
  if (typeof Calendar !== 'undefined' && Calendar.Events) {
    // Google Calendar API (dienst toevoegen in de editor): alle afspraken in een paar aanvragen
    via = 'api';
    try { tz = Calendar.Calendars.get('primary').timeZone || tz; } catch (err) {}
    var from = new Date(now.getTime() - DAYS_BACK * 864e5), to = new Date(now.getTime() + DAYS_AHEAD * 864e5);
    var pageToken = null;
    do {
      var res = Calendar.Events.list('primary', {
        timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, maxResults: 2500, pageToken: pageToken,
        fields: 'nextPageToken,items(summary,description,location,start,end,status,attendees(self,responseStatus))',
      });
      (res.items || []).forEach(function (it) {
        if (it.status === 'cancelled') return;
        var me = (it.attendees || []).filter(function (a) { return a.self; })[0];
        if (me && me.responseStatus === 'declined') return;
        var codes = findCodes_([it.summary, it.description, it.location].join(' '));
        if (!codes.length || !it.start || !it.end) return;
        if (it.start.date && !it.start.dateTime) {
          var last = new Date(Date.UTC(+it.end.date.slice(0, 4), +it.end.date.slice(5, 7) - 1, +it.end.date.slice(8, 10) - 1));
          add(codes, it.summary, it.start.date, Utilities.formatDate(last, 'UTC', 'yyyy-MM-dd'), 'hele dag');
        } else {
          var start = new Date(it.start.dateTime), end = new Date(it.end.dateTime);
          add(codes, it.summary, fmt(start, 'yyyy-MM-dd'), fmt(new Date(Math.max(start.getTime(), end.getTime() - 60e3)), 'yyyy-MM-dd'), fmt(start, 'HH:mm') + '–' + fmt(end, 'HH:mm'));
        }
      });
      pageToken = res.nextPageToken;
    } while (pageToken);
  } else {
    // zonder die dienst: kortere periode, en per afspraak zo min mogelijk vragen
    via = 'calendarapp';
    var cal = CalendarApp.getDefaultCalendar();
    tz = cal.getTimeZone() || tz;
    var from2 = new Date(now.getTime() - DAYS_BACK_SLOW * 864e5), to2 = new Date(now.getTime() + DAYS_AHEAD * 864e5);
    cal.getEvents(from2, to2).forEach(function (ev) {
      var title = ev.getTitle() || '';
      var codes = findCodes_(title);
      if (!codes.length) codes = findCodes_([ev.getDescription(), ev.getLocation()].join(' '));
      if (!codes.length) return;
      try { if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) return; } catch (err) {}
      var allDay = ev.isAllDayEvent();
      var start = ev.getStartTime(), end = ev.getEndTime();
      var lastMoment = new Date(Math.max(start.getTime(), end.getTime() - (allDay ? 864e5 : 60e3)));
      add(codes, title, fmt(start, 'yyyy-MM-dd'), fmt(lastMoment, 'yyyy-MM-dd'), allDay ? 'hele dag' : fmt(start, 'HH:mm') + '–' + fmt(end, 'HH:mm'));
    });
  }
  var data = { updated: fmt(now, "yyyy-MM-dd'T'HH:mm"), tz: tz, via: via, account: Session.getEffectiveUser().getEmail(), events: events };
  var json = JSON.stringify(data);
  if (json.length < 95000) cache.put('agenda', json, CACHE_SECONDS);
  return data;
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
  var data = collect_(true);
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
