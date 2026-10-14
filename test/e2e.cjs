// End-to-end checks with assertions. Usage: node e2e.cjs [outDir]
// Needs Playwright (global) and optionally JSPDF=<path to jspdf.umd.min.js> for the pdf step.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const here = __dirname;
const out = process.argv[2] || path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const app = fs.readFileSync(path.join(here, '../dist/artifact.html'), 'utf8');
const mock = fs.readFileSync(path.join(here, 'mock.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style><script>${mock}</script></head><body>${app}</body></html>`;

let pass = 0, fail = 0; const failures = [];
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; failures.push(name); console.log('  ✗ ' + name); } };

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/receipt.jpg')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(fs.readFileSync(path.join(here, 'receipt.jpg'))); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  }).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];

  async function newPage(mockOpts = {}, viewport = { width: 390, height: 844 }) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    if (process.env.JSPDF) await page.route('**/jspdf.umd.min.js', r => r.fulfill({ path: process.env.JSPDF, contentType: 'text/javascript' }));
    else await page.route('**/jspdf.umd.min.js', r => r.abort());
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.evaluate(o => { localStorage.clear(); localStorage.setItem('__mockOpts', JSON.stringify(o)); }, mockOpts);
    await page.reload();
    await page.waitForFunction(() => !/laden/.test(document.querySelector('#storageNote').textContent));
    return { page, ctx };
  }
  const val = (page, sel) => page.$eval(sel, e => e.value);
  const text = (page, sel) => page.$eval(sel, e => e.textContent);
  const visible = (page, sel) => page.$eval(sel, e => !e.closest('[hidden]') && !e.hidden);
  const scan = async (page, input = '#camInput') => { await page.setInputFiles(input, path.join(here, 'receipt.jpg')); await page.waitForSelector('#editor:not([hidden])'); };
  const settle = page => page.waitForFunction(() => !document.querySelector('#editor .spin'), null, { timeout: 5000 }).catch(() => {});

  // ---------------------------------------------------------------
  console.log('A. Scannen, uitlezen, project uit agenda (cloud)');
  {
    const { page, ctx } = await newPage();
    ok(await visible(page, '#setupCard'), 'instelkaart zichtbaar zonder naam');
    ok((await text(page, '#storageNote')).includes('Claude-account'), 'opslag in Claude-account');
    await page.click('#setupGo');
    await page.fill('#sName', 'Sanne de Vries');
    await page.fill('#sEmail', 'administratie@bedrijf.nl');
    await page.fill('#sIban', 'nl91abna0417164300');
    await page.click('#setDone');
    ok(!(await visible(page, '#setupCard')), 'instelkaart weg na naam');
    await scan(page); await settle(page);
    ok(await val(page, '#inAmount') === '23,50', 'bedrag 23,50 ingevuld');
    ok(await val(page, '#inDate') === '2026-10-08', 'datum 2026-10-08 ingevuld');
    ok(await val(page, '#inDesc') === 'Lunch met klant', 'omschrijving ingevuld');
    ok(await val(page, '#inMerchant') === 'Bagels & Beans', 'winkel ingevuld');
    ok(await val(page, '#inProject') === 'KLMN2041', 'project KLMN2041 automatisch gekozen');
    ok(await page.$eval('#fAmount', e => e.classList.contains('ai')), 'bedrag gemarkeerd als gelezen');
    const chips = await page.$$eval('#projAgenda .pchip b', a => a.map(b => b.textContent));
    ok(JSON.stringify(chips) === '["KLMN2041"]', 'geannuleerde afspraak genegeerd, 1 agenda-chip');
    const calls = await page.evaluate(() => window.__calls.filter(c => c.tool === 'list_events').map(c => c.input.startTime));
    ok(calls.length === 1 && calls[0] === '2026-10-08T00:00:00', 'agenda één keer opgevraagd, voor de bondatum (niet vandaag)');
    const sc = await page.evaluate(() => window.__calls.find(c => c.sample));
    ok(sc && sc.hasImg, 'foto meegestuurd naar Claude');
    await page.fill('#inAmount', '');
    ok(!(await page.$eval('#fAmount', e => e.classList.contains('ai'))), 'label verdwijnt na wijzigen');
    await page.fill('#inAmount', '1.234,5'); await page.click('#inDesc');
    ok(await val(page, '#inAmount') === '1234,50', 'bedrag "1.234,5" → 1234,50');
    await page.fill('#inAmount', '23.5'); await page.click('#inDesc');
    ok(await val(page, '#inAmount') === '23,50', 'bedrag "23.5" → 23,50');
    await page.click('#edDeclare');
    await page.waitForSelector('#sendWrap:not([hidden])');
    await page.waitForFunction(() => !document.querySelector('#sendShare').disabled);
    ok(await val(page, '#mTo') === 'administratie@bedrijf.nl', 'adres administratie ingevuld');
    ok(await val(page, '#mSubject') === 'Declaratie KLMN2041 – Lunch met klant – € 23,50', 'onderwerp klopt');
    const body = await val(page, '#mBody');
    ok(body.includes('Project: KLMN2041') && body.includes('Datum: 8 oktober 2026') && body.includes('Bedrag: € 23,50'), 'mail bevat project, datum, bedrag');
    ok(body.includes('NL91ABNA0417164300 t.n.v. Sanne de Vries'), 'IBAN in hoofdletters en naam in mail');
    ok(body.trim().endsWith('Sanne de Vries'), 'mail eindigt met naam');
    ok((await page.getAttribute('#sendMailto', 'href')).startsWith('mailto:administratie@bedrijf.nl?subject=Declaratie%20KLMN2041'), 'mailto-link klopt');
    await page.click('#sendShare'); await page.waitForTimeout(300);
    const saved = await page.evaluate(() => window.__saved);
    ok(saved.length === 1 && saved[0].filename === 'Declaratie_KLMN2041_2026-10-08_Lunch-met-klant.jpg' && saved[0].type === 'image/jpeg', 'foto als jpg in deelmenu');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    ok(clip === body, 'mailtekst gekopieerd');
    ok(await visible(page, '#sendDone'), 'vraag "Is de mail verstuurd?" verschijnt');
    await page.screenshot({ path: path.join(out, 'A-send-done.png') });
    await page.click('#sendMark'); await page.waitForTimeout(200);
    ok((await text(page, '#summary .big')) === '€ 0,00', 'open totaal 0 na versturen');
    await page.click('#toast button'); await page.waitForTimeout(200);
    ok((await text(page, '#summary .big')) === '€ 23,50', 'ongedaan maken zet bon terug');
    // persistence
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#list .row').length === 1);
    ok((await text(page, '#summary .big')) === '€ 23,50', 'na herladen nog 1 open bon (cloud)');
    await page.waitForFunction(() => document.querySelector('#list .row img'), null, { timeout: 3000 }).catch(() => {});
    ok(!!(await page.$('#list .row img')), 'miniatuur na herladen zichtbaar');
    await ctx.close();
  }

  // ---------------------------------------------------------------
  console.log('B. Meerdere projecten, handmatige keuze, datum wijzigen');
  {
    const { page, ctx } = await newPage();
    await page.evaluate(() => { window.__sampleAnswer = { total: 41.8, date: '2026-10-09', merchant: 'Q-Park', description: 'Parkeren', category: 'Parkeren', readable: true }; });
    await scan(page); await settle(page);
    const chips = await page.$$eval('#projAgenda .pchip b', a => a.map(b => b.textContent));
    ok(JSON.stringify(chips) === '["RTSV3310","ABCD1234"]', 'twee projecten (ook met streepje RTSV-3310) gevonden');
    ok(await val(page, '#inProject') === '', 'bij meerdere projecten niets automatisch gekozen');
    await page.click('#projAgenda .pchip >> nth=1');
    ok(await val(page, '#inProject') === 'ABCD1234', 'tikken op chip kiest project');
    await page.fill('#inDate', '2026-10-08'); await page.dispatchEvent('#inDate', 'change'); await settle(page);
    ok(await val(page, '#inProject') === 'ABCD1234', 'zelf gekozen project blijft staan bij andere datum');
    await page.fill('#inProject', ''); await page.dispatchEvent('#inProject', 'input');
    await page.fill('#inDate', '2026-10-09'); await page.dispatchEvent('#inDate', 'change'); await settle(page);
    await page.fill('#inDate', '2026-10-08'); await page.dispatchEvent('#inDate', 'change'); await settle(page);
    ok(await val(page, '#inProject') === 'KLMN2041', 'lege code + datum met één project → automatisch gekozen');
    await page.fill('#inDate', '2026-10-10'); await page.dispatchEvent('#inDate', 'change'); await settle(page);
    ok(await val(page, '#inProject') === '', 'automatisch project wordt gewist bij nieuwe datum');
    ok((await text(page, '#projAgenda')).includes('Geen afspraak met projectcode'), '"Week 2026" telt niet als projectcode');
    await page.type('#inProject', 'ab-cd 12345');
    ok(await val(page, '#inProject') === 'ABCD12345'.slice(0, 9), 'code wordt hoofdletters zonder tekens');
    ok(await page.$eval('#fProject', e => e.classList.contains('bad')), 'ongeldige code gemarkeerd');
    await page.click('#edDeclare'); await page.waitForTimeout(100);
    ok(await visible(page, '#toast') && (await text(page, '#toast')).includes('projectcode'), 'declareren met ongeldige code geweigerd');
    await page.fill('#inProject', 'abcd1234'); await page.dispatchEvent('#inProject', 'input');
    await page.click('#edSave'); await page.waitForSelector('#editor', { state: 'hidden' });
    ok((await page.$$('#list .row')).length === 1, 'bon bewaard');
    await page.click('#list .row');
    await page.waitForSelector('#editor:not([hidden])');
    ok(await val(page, '#inProject') === 'ABCD1234' && await val(page, '#inAmount') === '41,80', 'bon opnieuw openen toont gegevens');
    await page.click('#edDelete'); await page.click('#edDeleteYes'); await page.waitForTimeout(200);
    ok((await page.$$('#list .row')).length === 0, 'bon verwijderd');
    await ctx.close();
  }

  // ---------------------------------------------------------------
  console.log('C. Meerdere bonnen in één declaratie (pdf)');
  {
    const { page, ctx } = await newPage();
    await page.click('#setupGo'); await page.fill('#sName', 'Sanne'); await page.click('#setDone');
    for (const a of [
      { total: 23.5, date: '2026-10-08', merchant: 'Bagels & Beans', description: 'Lunch', category: 'Maaltijd', readable: true },
      { total: 12.75, date: '2026-10-08', merchant: 'NS', description: 'Treinkaartje', category: 'Reiskosten', readable: true },
      { total: 9, date: '2026-10-11', merchant: 'Gamma', description: 'Schroeven', category: 'Materiaal', readable: true },
    ]) {
      await page.evaluate(x => { window.__sampleAnswer = x; }, a);
      await scan(page); await settle(page);
      await page.click('#edSave'); await page.waitForSelector('#editor', { state: 'hidden' });
    }
    ok((await text(page, '#summary .big')) === '€ 45,25', 'open totaal € 45,25');
    ok((await text(page, '#summary')).includes('1 nog aanvullen'), 'bon zonder project gemeld');
    await page.click('#summary button'); await page.waitForSelector('#sendWrap:not([hidden])');
    const boxes = await page.$$eval('#sendItems input[type=checkbox]', a => a.map(c => [c.checked, c.disabled]));
    ok(JSON.stringify(boxes) === '[[false,true],[true,false],[true,false]]', 'onvolledige bon niet aangevinkt');
    ok(await val(page, '#mSubject') === 'Declaraties KLMN2041 – 2 bonnen – € 36,25', 'onderwerp voor 2 bonnen');
    const body = await val(page, '#mBody');
    ok(!body.includes('overmaken'), 'regel met lege IBAN weggelaten');
    ok(/1\. 08-10-2026 · KLMN2041 · (Lunch|Treinkaartje)/.test(body), 'genummerd overzicht');
    if (process.env.JSPDF) {
      await page.waitForFunction(() => !document.querySelector('#sendShare').disabled, null, { timeout: 8000 });
      ok((await text(page, '#mAttach')).includes('.pdf'), 'pdf als bijlage');
      await page.click('#sendShare'); await page.waitForTimeout(300);
      const s = await page.evaluate(() => window.__saved[0]);
      ok(s && s.type === 'application/pdf' && s.size > 20000, 'pdf gemaakt (' + (s && s.size) + ' bytes)');
      const b64 = await page.evaluate(async () => { const b = new Uint8Array(await window.__lastBlob.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); });
      fs.writeFileSync(path.join(out, 'C-declaratie.pdf'), Buffer.from(b64, 'base64'));
    } else {
      await page.waitForFunction(() => /lukte niet/.test(document.querySelector('#mAttach').textContent), null, { timeout: 8000 });
      ok(await page.$eval('#sendShare', b => b.disabled), 'zonder pdf-bibliotheek: duidelijke melding, knop uit');
    }
    // uncheck one → single → jpg
    await page.click('#sendItems label.it >> nth=1');
    await page.waitForFunction(() => /\.jpg/.test(document.querySelector('#mAttach').textContent), null, { timeout: 5000 });
    ok(true, 'na uitvinken 1 bon → jpg-bijlage');
    await ctx.close();
  }

  // ---------------------------------------------------------------
  console.log('D. Zonder Claude (lokaal), handmatig invullen, herladen');
  {
    const { page, ctx } = await newPage({ noClaude: true });
    ok((await text(page, '#storageNote')).includes('dit apparaat'), 'lokale opslag gemeld');
    await scan(page, '#libInput');
    ok((await text(page, '#edStatus')).includes('Vul bedrag'), 'melding handmatig invullen');
    await page.fill('#inAmount', '7,5'); await page.fill('#inDesc', 'Koffie'); await page.fill('#inProject', 'ABCD1234'); await page.dispatchEvent('#inProject', 'input');
    await page.click('#edSave'); await page.waitForSelector('#editor', { state: 'hidden' });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#list .row').length === 1, null, { timeout: 4000 }).catch(() => {});
    ok((await page.$$('#list .row')).length === 1, 'bon blijft na herladen (IndexedDB)');
    await page.waitForFunction(() => document.querySelector('#list .row img'), null, { timeout: 3000 }).catch(() => {});
    ok(!!(await page.$('#list .row img')), 'foto blijft na herladen');
    await ctx.close();
  }

  // ---------------------------------------------------------------
  console.log('E. Agendafout en uitleesfout');
  {
    const { page, ctx } = await newPage({ calError: 'server_not_connected' });
    await page.evaluate(() => { window.__sampleAnswer = { __error: { code: 'rate_limited', message: 'x' } }; });
    await scan(page); await settle(page);
    ok((await text(page, '#edStatus')).includes('te veel'), 'uitleesfout: duidelijke melding');
    ok(!!(await page.$('#edStatus .copy')), 'knop Opnieuw aanwezig');
    ok((await text(page, '#projAgenda')).includes('Koppel Google Agenda'), 'agenda niet gekoppeld: uitleg');
    await page.evaluate(() => { window.__sampleAnswer = undefined; });
    await page.click('#edStatus .copy'); await settle(page);
    ok(await val(page, '#inAmount') === '23,50', 'opnieuw proberen vult bedrag');
    await page.click('#edCancel');
    ok((await page.$$('#list .row')).length === 0, 'annuleren bewaart niets');
    await ctx.close();
  }

  // ---------------------------------------------------------------
  console.log('F. Outlook .ics importeren');
  {
    const { page, ctx } = await newPage();
    await page.click('#openSettings');
    await page.click('#calSrc [data-src=ics]');
    await page.setInputFiles('#icsInput', path.join(here, 'sample.ics')); await page.waitForTimeout(300);
    const info = await text(page, '#icsResult');
    ok(info.includes('2 afspraken') && info.includes('WXYZ5678') && info.includes('QRST4321'), 'ics: 2 afspraken met code gelezen (gevouwen regel, escapes)');
    await page.click('#setDone');
    await page.evaluate(() => { window.__sampleAnswer = { total: 5, date: '2026-10-13', merchant: 'AH', description: 'Water', category: 'Overig', readable: true }; });
    await scan(page); await settle(page);
    ok(await val(page, '#inProject') === 'QRST4321', 'meerdaagse afspraak (12–14 okt) gevonden op 13 okt');
    await page.fill('#inDate', '2026-10-15'); await page.dispatchEvent('#inDate', 'change'); await settle(page);
    ok(await val(page, '#inProject') === '', 'einddatum all-day exclusief: 15 okt niet meer');
    await page.fill('#inDate', '2026-10-08'); await page.dispatchEvent('#inDate', 'change'); await settle(page);
    ok(await val(page, '#inProject') === 'WXYZ5678', 'afspraak met TZID gevonden');
    const t = await page.$eval('#projAgenda .pchip span', e => e.textContent);
    ok(t.includes('10:00–12:00') && t.includes('met architect'), 'tijd en gevouwen titel kloppen');
    await page.reload(); await page.waitForTimeout(500);
    await page.click('#openSettings');
    ok((await text(page, '#icsResult')).includes('2 afspraken'), 'ics bewaard na herladen');
    await ctx.close();
  }

  // ---------------------------------------------------------------
  console.log('G. Instellingen: agenda kiezen, eigen mailtekst');
  {
    const { page, ctx } = await newPage();
    await page.click('#openSettings');
    await page.click('#calLoad'); await page.waitForTimeout(400);
    await page.click('#calResult button >> text=Werk');
    ok(await val(page, '#sCalId') === 'werk@group.calendar.google.com', 'werkagenda gekozen uit lijst');
    await page.fill('#sTpl', 'Hoi,\n\n{overzicht}\n\nGroet, {naam}\nIBAN: {iban}');
    await page.fill('#sName', 'J. Test');
    await page.click('#setDone');
    await scan(page); await settle(page);
    const lc = await page.evaluate(() => window.__calls.filter(c => c.tool === 'list_events').pop().input.calendarId);
    ok(lc === 'werk@group.calendar.google.com', 'gekozen agenda wordt gebruikt');
    await page.click('#edDeclare'); await page.waitForSelector('#sendWrap:not([hidden])');
    const body = await val(page, '#mBody');
    ok(body.startsWith('Hoi,') && body.includes('Groet, J. Test') && !body.includes('IBAN'), 'eigen mailtekst gebruikt, lege IBAN-regel weg');
    await page.fill('#mTo', 'nieuw@bedrijf.nl'); await page.dispatchEvent('#mTo', 'change'); await page.waitForTimeout(100);
    await page.reload(); await page.waitForTimeout(400);
    await page.click('#openSettings');
    ok(await val(page, '#sEmail') === 'nieuw@bedrijf.nl', 'adres uit verzendscherm onthouden');
    await ctx.close();
  }

  // ---------------------------------------------------------------
  console.log('H. Opmaak op smalle schermen');
  for (const w of [320, 375, 430]) {
    const { page, ctx } = await newPage({}, { width: w, height: 760 });
    await scan(page); await settle(page);
    const ov1 = await page.evaluate(() => document.querySelector('#editor').scrollWidth > document.querySelector('#editor').clientWidth);
    await page.click('#edDeclare'); await page.waitForSelector('#sendWrap:not([hidden])');
    const ov2 = await page.evaluate(() => document.querySelector('.sheet').scrollWidth > document.querySelector('.sheet').clientWidth);
    await page.click('#sendClose');
    const ov3 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!ov1 && !ov2 && !ov3, `geen horizontale scroll op ${w}px`);
    if (w === 320) await page.screenshot({ path: path.join(out, 'H-320.png') });
    await ctx.close();
  }

  console.log('\nFouten in console: ' + (errors.length ? '\n' + errors.join('\n') : 'geen'));
  console.log(`\n${pass} geslaagd, ${fail} mislukt`);
  if (fail) console.log('Mislukt:\n- ' + failures.join('\n- '));
  await browser.close(); server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
