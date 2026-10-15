// End-to-end checks for the free web app (site/): real on-device text recognition, agenda file,
// share sheet, offline start. Run after `node tools/build.mjs`: node test/web.e2e.cjs [outDir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const here = __dirname, site = path.join(here, '../site');
const out = process.argv[2] || path.join(here, 'out-web');
fs.mkdirSync(out, { recursive: true });
let pass = 0, fail = 0; const failures = [];
const ok = (c, n) => { c ? pass++ : (fail++, failures.push(n)); console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript', json: 'application/json', webmanifest: 'application/manifest+json', png: 'image/png', gz: 'application/gzip', enc: 'application/json' };

(async () => {
  // build with an app password and an agenda file encrypted with it, as the GitHub workflow does
  const PASS = 'Zomer2026!';
  execFileSync('node', [path.join(here, '../tools/build.mjs')], { env: { ...process.env, APP_PASSWORD: PASS } });
  execFileSync('node', [path.join(here, '../tools/agenda-sync.mjs'), path.join(site, 'agenda.enc')], { env: { ...process.env, TZ: 'Europe/Amsterdam', AGENDA_ICS_URL: path.join(here, 'sample.ics'), APP_PASSWORD: PASS } });
  ok(!fs.readFileSync(path.join(site, 'lock.json'), 'utf8').includes(PASS) && !fs.readFileSync(path.join(site, 'index.html'), 'utf8').includes(PASS), 'wachtwoord zelf staat nergens in de site');
  let offline = false;
  const server = http.createServer((req, res) => {
    if (offline) { req.socket.destroy(); return; }
    const p = path.join(site, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(site) || !fs.existsSync(p)) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': TYPES[p.split('.').pop()] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(0);
  const url = `http://localhost:${server.address().port}/`;
  // stand-in for script.google.com: the real Code.gs behind it, on another origin (as in reality)
  const gas = require('./gas-harness.cjs').run('');
  const gasServer = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/login') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>Inloggen bij Google</html>'); }
    const r = gas.ctx.doGet({ parameter: Object.fromEntries(u.searchParams) });
    res.writeHead(200, { 'content-type': r.mime === 'json' ? 'application/json' : 'text/plain', 'access-control-allow-origin': '*' });
    res.end(r.text);
  }).listen(0);
  const gasBase = `http://127.0.0.1:${gasServer.address().port}/exec`;
  gas.ctx.doGet({ parameter: { key: 'x' } }); // creates the key
  const ownerPage = require('./gas-harness.cjs').run('jorg@werk.nl');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  await ctx.addInitScript(() => {
    // the iOS share sheet: remember what would be handed to Mail
    window.__shared = [];
    navigator.canShare = d => !!(d && d.files && d.files.length);
    navigator.share = async d => { window.__shared.push({ title: d.title, text: d.text, files: (d.files || []).map(f => ({ name: f.name, type: f.type, size: f.size })) }); };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  // expected: going offline, and the deliberately blocked "login" link in the work-agenda test
  const expected = t => (offline && /INTERNET_DISCONNECTED/.test(t)) || /\/login\?key|ERR_FAILED/.test(t);
  page.on('console', m => { if (m.type() === 'error' && !expected(m.text())) errors.push(m.text()); });
  const val = s => page.$eval(s, e => e.value);
  const text = s => page.$eval(s, e => e.textContent);
  const settle = () => page.waitForFunction(() => !document.querySelector('#edStatus .spin') && !document.querySelector('#projAgenda .spin'), null, { timeout: 90000 });

  const unlock = async (pw, remember = true) => {
    await page.waitForSelector('#lock:not([hidden])');
    await page.fill('#lockPass', pw);
    if (!remember) await page.uncheck('#lockRemember');
    await page.click('#lockGo');
  };
  console.log('Wachtwoordslot');
  await page.goto(url);
  await page.waitForSelector('#lock:not([hidden])');
  ok((await page.$$('#list .row')).length === 0 && (await text('#storageNote')).includes('laden'), 'slot verschijnt voordat er iets geladen wordt');
  await page.screenshot({ path: path.join(out, 'web-lock.png') });
  await unlock('fout');
  await page.waitForFunction(() => document.querySelector('#lockErr').textContent.length > 0);
  ok((await text('#lockErr')).includes('klopt niet') && await page.$eval('#lock', e => !e.hidden), 'verkeerd wachtwoord geweigerd');
  await unlock(PASS);
  await page.waitForSelector('#lock', { state: 'hidden' });
  await page.waitForFunction(() => /telefoon/.test(document.querySelector('#storageNote').textContent));
  ok(true, 'goed wachtwoord ontgrendelt');
  await page.reload(); await page.waitForFunction(() => /telefoon/.test(document.querySelector('#storageNote').textContent));
  ok(await page.$eval('#lock', e => e.hidden), 'onthouden: na herstart geen wachtwoord nodig');
  await page.click('#openSettings');
  ok((await text('#secBox')).includes('beveiligd'), 'instellingen tonen beveiliging');
  await Promise.all([page.waitForNavigation(), page.click('#secBox button')]);
  await page.waitForSelector('#lock:not([hidden])');
  ok(true, '"Vergrendel op deze iPhone" vraagt weer om het wachtwoord');
  await unlock(PASS, false);
  await page.waitForSelector('#lock', { state: 'hidden' });
  await page.reload(); await page.waitForSelector('#lock:not([hidden])');
  ok(true, 'zonder onthouden: na herstart weer wachtwoord nodig');
  await unlock(PASS);
  await page.waitForFunction(() => /telefoon/.test(document.querySelector('#storageNote').textContent));

  console.log('Start en instellingen');
  ok(true, 'app start zonder Claude, "Bewaard op deze telefoon"');
  ok(await page.$eval('link[rel=manifest]', e => !!e.href) && await page.$eval('link[rel=apple-touch-icon]', e => !!e.href), 'beginscherm-icoon en manifest aanwezig');
  await page.click('#setupGo');
  ok(await page.$eval('#calSrc [data-src=google]', e => e.hidden), 'Google-knop verborgen zonder Claude');
  ok(await page.$eval('#calSrc [data-src=ics]', e => e.getAttribute('aria-pressed')) === 'true', 'standaard: agenda uit bestand');
  await page.fill('#sName', 'Sanne de Vries'); await page.fill('#sEmail', 'administratie@bedrijf.nl');
  await page.click('#calSrc [data-src=sync]');
  await page.fill('#sSyncPass', 'fout'); await page.click('#syncTest');
  await page.waitForFunction(() => /klopt|Gelukt|niet|nog geen/.test(document.querySelector('#syncResult').textContent), null, { timeout: 15000 }).catch(() => {});
  ok((await text('#syncResult')).includes('klopt niet'), 'verkeerd agenda-wachtwoord: duidelijke melding');
  await page.fill('#sSyncPass', ''); await page.click('#syncTest');
  await page.waitForFunction(() => /Gelukt/.test(document.querySelector('#syncResult').textContent), null, { timeout: 15000 }).catch(() => {});
  ok((await text('#syncResult')).includes('2 afspraken'), 'agenda ontsleuteld met het app-wachtwoord (veld leeg gelaten)');
  await page.click('#setDone');

  console.log('Bonnen lezen op de telefoon (echte tekstherkenning)');
  const cases = [
    { file: 'photo-lunch.jpg', amount: '23,50', date: '2026-10-08', merchant: 'Bagels & Beans', desc: 'Lunch', project: 'WXYZ5678' },
    { file: 'photo-parking.jpg', amount: '18,90', date: '2026-10-09', merchant: 'Q-Park', desc: 'Parkeren', project: '' },
    { file: 'photo-fuel.jpg', amount: '85,16', date: '2026-10-12', merchant: 'Shell', desc: 'Brandstof', project: 'QRST4321' },
  ];
  for (const c of cases) {
    const t0 = Date.now();
    await page.setInputFiles('#camInput', path.join(here, c.file));
    await page.waitForSelector('#editor:not([hidden])');
    await settle();
    const got = { amount: await val('#inAmount'), date: await val('#inDate'), merchant: await val('#inMerchant'), desc: await val('#inDesc'), project: await val('#inProject') };
    console.log(`    ${c.file}: ${JSON.stringify(got)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    ok(got.amount === c.amount, `${c.file}: bedrag ${c.amount}`);
    ok(got.date === c.date, `${c.file}: datum ${c.date}`);
    ok(got.merchant === c.merchant, `${c.file}: winkel ${c.merchant}`);
    ok(got.desc === c.desc, `${c.file}: omschrijving ${c.desc}`);
    ok(got.project === c.project, `${c.file}: project uit agenda "${c.project}"`);
    if (c.file === 'photo-lunch.jpg') await page.screenshot({ path: path.join(out, 'web-read.png') });
    if (!got.project) { await page.fill('#inProject', 'ABCD1234'); await page.dispatchEvent('#inProject', 'input'); }
    await page.click('#edSave'); await page.waitForSelector('#editor', { state: 'hidden' });
  }

  console.log('Declareren via het deelmenu');
  await page.click('#list .row >> nth=0');
  await page.waitForSelector('#editor:not([hidden])');
  await page.click('#edDeclare'); await page.waitForSelector('#sendWrap:not([hidden])');
  await page.waitForFunction(() => !document.querySelector('#sendShare').disabled);
  ok((await text('#sendSteps')).includes('bijlage en de mailtekst'), 'uitleg past bij deelmenu');
  await page.click('#sendShare'); await page.waitForTimeout(300);
  let sh = await page.evaluate(() => window.__shared.pop());
  ok(sh && sh.files.length === 1 && sh.files[0].type === 'image/jpeg' && sh.text.includes('Totaal te vergoeden') && sh.title.startsWith('Declaratie '), 'foto + mailtekst + onderwerp naar deelmenu');
  await page.click('#sendNotYet'); await page.click('#sendClose');
  await page.click('#summary button'); await page.waitForSelector('#sendWrap:not([hidden])');
  await page.waitForFunction(() => !document.querySelector('#sendShare').disabled, null, { timeout: 15000 });
  await page.click('#sendShare'); await page.waitForTimeout(300);
  sh = await page.evaluate(() => window.__shared.pop());
  ok(sh && sh.files[0].type === 'application/pdf' && sh.files[0].size > 30000 && /3 bonnen/.test(sh.title), 'drie bonnen als één pdf (pdf-bibliotheek uit de app zelf)');
  await page.click('#sendMark'); await page.waitForTimeout(200);
  ok((await text('#summary .big')) === '€ 0,00', 'alles bij Verstuurd');
  await page.screenshot({ path: path.join(out, 'web-home.png') });

  console.log('Google-werkagenda via script');
  await page.click('#openSettings');
  await page.click('#calSrc [data-src=gas]');
  ok(await page.$eval('#calGas', e => !e.hidden), 'keuze "Google (werk)" toont de koppeling');
  const tryLink = async link => {
    await page.$eval('#gasResult', e => { e.textContent = ''; });
    await page.fill('#sGasUrl', link); await page.click('#gasTest');
    await page.waitForFunction(() => { const t = document.querySelector('#gasResult').textContent; return t && !/ophalen/.test(t); }, null, { timeout: 10000 });
    return text('#gasResult');
  };
  ok((await tryLink(gasBase + '?key=fout')).includes('sleutel onjuist'), 'verkeerde sleutel: duidelijke melding');
  ok((await tryLink(gasBase.replace('/exec', '/login') + '?key=x')).includes('Iedereen'), 'link die om inloggen vraagt: uitleg over toegang "Iedereen"');
  ok((await tryLink(gasBase + '?key=' + gas.props.KEY)).includes('4 afspraken met projectcode'), 'goede link: afspraken opgehaald (ander domein)');
  await page.click('#setDone');
  await page.setInputFiles('#camInput', path.join(here, 'photo-lunch.jpg'));
  await page.waitForSelector('#editor:not([hidden])'); await settle();
  ok(await val('#inProject') === 'KLMN2041', 'bon van 8 okt krijgt project uit werkagenda');
  await page.click('#edCancel');
  await page.click('#openSettings');
  await page.fill('#sGasUrl', ''); await page.dispatchEvent('#sGasUrl', 'change');
  await page.fill('#sGasCode', 'iets anders'); await page.click('#gasImport');
  ok((await text('#gasResult')).includes('geen geldige agenda-code'), 'ongeldige agenda-code geweigerd');
  const code = /DECL1:[A-Za-z0-9+/=]+/.exec(ownerPage.ctx.doGet({ parameter: {} }).html)[0];
  await page.fill('#sGasCode', code); await page.click('#gasImport');
  ok((await text('#gasResult')).includes('uit agenda-code'), 'agenda-code ingelezen zonder link');
  await page.click('#setDone');
  await page.click('#tabOpen');

  console.log('Offline starten');
  await page.reload(); await page.waitForTimeout(1500);
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); const keys = await caches.keys(); const c = keys.length ? await caches.open(keys[0]) : null; return { active: !!(r && r.active), cached: c ? (await c.keys()).length : 0 }; });
  ok(sw.active && sw.cached >= 10, `offline-cache actief (${sw.cached} bestanden)`);
  offline = true; await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => /telefoon/.test(document.querySelector('#storageNote').textContent), null, { timeout: 10000 }).catch(() => {});
  ok((await page.$$('#list .row')).length === 0 && (await text('#summary .big')) === '€ 0,00', 'app opent zonder internet, gegevens bewaard');
  await page.click('#tabSent');
  ok((await page.$$('#list .row')).length === 3, 'verstuurde bonnen zichtbaar offline');
  await page.setInputFiles('#camInput', path.join(here, 'photo-parking.jpg'));
  await page.waitForSelector('#editor:not([hidden])'); await settle();
  ok(await val('#inAmount') === '18,90', 'tekstherkenning werkt offline');
  ok((await text('#projAgenda')).length > 0, 'agenda offline: laatst opgehaalde versie of nette melding');

  ok(await page.$eval('#lock', e => e.hidden), 'offline: onthouden ontgrendeling blijft werken');

  console.log('Zonder ingesteld wachtwoord');
  offline = false;
  execFileSync('node', [path.join(here, '../tools/build.mjs')], { env: { ...process.env, APP_PASSWORD: '' } });
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p2 = await ctx2.newPage();
  await p2.goto(url); await p2.waitForFunction(() => /telefoon/.test(document.querySelector('#storageNote').textContent));
  ok(await p2.$eval('#lock', e => e.hidden), 'geen slot als er geen wachtwoord is ingesteld');
  await p2.click('#openSettings');
  ok((await p2.$eval('#secBox', e => e.textContent)).includes('APP_PASSWORD'), 'instellingen leggen uit hoe je een wachtwoord instelt');
  await ctx2.close();
  fs.rmSync(path.join(site, 'agenda.enc'), { force: true });
  console.log('\nFouten in console: ' + (errors.length ? '\n' + errors.join('\n') : 'geen'));
  console.log(`\n${pass} geslaagd, ${fail} mislukt`);
  if (fail) console.log('Mislukt:\n- ' + failures.join('\n- '));
  await browser.close(); server.close(); gasServer.close();
  process.exit(fail ? 1 : 0);
})();
