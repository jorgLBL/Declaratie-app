// Runs tools/apps-script/Code.gs with stand-ins for Google's services. Run: node test/apps-script.test.cjs
const L = require('../src/lib.js');

let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

const { run } = require('./gas-harness.cjs');

console.log('Apps Script');
{
  const { ctx, props } = run('');
  const anon = ctx.doGet({ parameter: {} });
  ok(anon.html && anon.html.includes('Geen toegang'), 'zonder sleutel en niet ingelogd: geen toegang');
  const bad = JSON.parse(ctx.doGet({ parameter: { key: 'raden' } }).text);
  ok(bad.error === 'key' && !('events' in bad), 'verkeerde sleutel: geen afspraken');
  const key = props.KEY;
  ok(/^[0-9a-f]{64}$/.test(key), 'sleutel is 64 tekens willekeurig');
  const r = ctx.doGet({ parameter: { key } });
  const data = JSON.parse(r.text);
  const by = d => data.events.filter(e => e.s <= d && d <= e.e).map(e => `${e.code} ${e.time}`);
  ok(r.mime === 'json', 'juiste sleutel: JSON');
  ok(JSON.stringify(by('2026-10-08')) === '["KLMN2041 10:00–13:00"]', 'afspraak met code, "Boulderen" weggelaten');
  ok(JSON.stringify(by('2026-10-09')) === '["RTSV3310 09:00–10:00"]', 'code in beschrijving gevonden, afgeslagen afspraak weggelaten');
  ok(JSON.stringify(by('2026-10-14')) === '["ABCD1234 hele dag"]' && by('2026-10-15').length === 0, 'meerdaagse hele-dag-afspraak 12–14 okt');
  ok(JSON.stringify(by('2026-10-11')) === '["WXYZ1111 22:00–02:00"]', 'afspraak over middernacht loopt door tot de volgende dag');
  const ics = ctx.doGet({ parameter: { key, format: 'ics' } });
  const parsed = L.parseIcs(ics.text, { today: '2026-10-14' });
  const pby = d => parsed.filter(e => e.s <= d && d <= e.e).map(e => `${e.code} ${e.time}`).sort();
  ok(ics.mime === 'ical' && JSON.stringify(pby('2026-10-13')) === '["ABCD1234 hele dag"]' && JSON.stringify(pby('2026-10-08')) === '["KLMN2041 10:00–13:00"]', '.ics-uitvoer leest terug in de app-parser');
}
{
  const { ctx, props } = run('jorg@werk.nl');
  const page = ctx.doGet({ parameter: {} }).html;
  ok(page.includes('https://script.google.com/macros/s/ABC/exec?key=' + props.KEY), 'eigen pagina toont app-link met sleutel');
  const code = /DECL1:([A-Za-z0-9+/=]+)/.exec(page);
  const data = code && JSON.parse(Buffer.from(code[1], 'base64').toString('utf8'));
  ok(data && data.events.length === 4 && data.updated, 'eigen pagina toont agenda-code die terug te lezen is');
  ok(page.includes('4 afspraken met projectcode') && page.includes('4 projecten'), 'pagina vat samen wat gevonden is');
}
console.log('Snel ophalen');
{
  const api = run('', { api: true });
  api.ctx.doGet({ parameter: { key: 'x' } });
  const d = JSON.parse(api.ctx.doGet({ parameter: { key: api.props.KEY } }).text);
  const by = day => d.events.filter(e => e.s <= day && day <= e.e).map(e => `${e.code} ${e.time}`).sort().join(',');
  ok(d.via === 'api' && api.out.apiCalls === 2 && api.out.lastQuery.singleEvents === true, 'met Calendar API: alle afspraken in 2 aanvragen (2 pagina\'s)');
  ok(by('2026-10-08') === 'KLMN2041 10:00–13:00' && by('2026-10-09') === 'RTSV3310 09:00–10:00' && by('2026-10-14') === 'ABCD1234 hele dag' && by('2026-10-15') === '' && by('2026-10-11') === 'WXYZ1111 22:00–02:00',
    'zelfde uitkomst via API: afgeslagen en geannuleerd weg, hele dag en over middernacht goed');
  api.ctx.doGet({ parameter: { key: api.props.KEY } });
  ok(api.out.apiCalls === 2, 'tweede vraag binnen 10 minuten komt uit het geheugen, geen nieuwe aanvraag');
  const slow = run('');
  slow.ctx.doGet({ parameter: { key: 'x' } });
  const s2 = JSON.parse(slow.ctx.doGet({ parameter: { key: slow.props.KEY } }).text);
  ok(s2.via === 'calendarapp' && s2.events.length === d.events.length, 'zonder die dienst: zelfde afspraken, via CalendarApp');
  ok(slow.out.calls <= 6 * 2 + 4 * 4, `zonder die dienst: weinig losse vragen per afspraak (${slow.out.calls} voor 6 afspraken)`);
  slow.ctx.test();
  ok(slow.out.logs.some(l => /traag; voeg de dienst Google Calendar API toe/.test(l)) && slow.out.logs.some(l => /jorg@werk\.nl/.test(l)), 'test() meldt snelheid, advies en afzender');
}

console.log('Concept in Gmail');
{
  const { ctx, props, out } = run('');
  ctx.doGet({ parameter: { key: 'x' } });
  const post = (key, body) => JSON.parse(ctx.doPost({ parameter: { key }, postData: { contents: JSON.stringify(body) } }).text);
  const img = Buffer.from('nep-jpeg-bytes').toString('base64');
  const req = { action: 'draft', to: 'administratie@bedrijf.nl', subject: 'Declaratie KLMN2041 – Lunch – € 23,50', body: 'Beste administratie,\n\nHierbij…', name: 'Jorg', attachments: [{ name: 'Declaratie_KLMN2041.jpg', type: 'image/jpeg', data: img }] };
  ok(post('fout', req).error === 'key' && out.drafts.length === 0, 'verkeerde sleutel: geen concept');
  ok(post(props.KEY, { ...req, to: 'geen-adres' }).error === 'to', 'ongeldig adres geweigerd');
  ok(post(props.KEY, { ...req, action: 'send' }).error === 'request' && out.drafts.length === 0, 'alleen concepten, nooit direct versturen');
  const r = post(props.KEY, req);
  const d = out.drafts[0];
  ok(r.ok && r.account === 'jorg@werk.nl' && r.messageId, 'concept gemaakt, afzender = account van het script');
  ok(d && d.to === req.to && d.subject === req.subject && d.body === req.body && d.options.name === 'Jorg', 'aan, onderwerp, tekst en naam kloppen');
  ok(d && d.options.attachments.length === 1 && d.options.attachments[0].name === 'Declaratie_KLMN2041.jpg' && Buffer.from(d.options.attachments[0].bytes).toString() === 'nep-jpeg-bytes', 'bijlage komt ongeschonden mee');
  out.gmailFails = true;
  const f = post(props.KEY, req);
  ok(f.error === 'gmail' && /niet toegestaan/.test(f.message), 'Gmail-fout wordt netjes teruggegeven');
}
console.log(`\n${pass} geslaagd, ${fail} mislukt`);
process.exit(fail ? 1 : 0);
