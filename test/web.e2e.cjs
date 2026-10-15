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
  let gasImpl = gas, gasOld = false; // gasOld: an older script without online storage
  const gasPosts = [];
  const gasServer = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/login') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>Inloggen bij Google</html>'); }
    const reply = r => { res.writeHead(200, { 'content-type': r.mime === 'json' ? 'application/json' : 'text/plain', 'access-control-allow-origin': '*' }); res.end(r.text); };
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => {
        gasPosts.push(req.headers['content-type']);
        if (gasOld && JSON.parse(body).action !== 'draft') return reply({ mime: 'json', text: '{"error":"request"}' });
        reply(gasImpl.ctx.doPost({ parameter: Object.fromEntries(u.searchParams), postData: { contents: body } }));
      });
      return;
    }
    reply(gasImpl.ctx.doGet({ parameter: Object.fromEntries(u.searchParams) }));
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
    await page.$eval('#gasAcct', e => { e.textContent = ''; });
    await page.fill('#sGasUrl', link); await page.click('#gasTest');
    await page.waitForFunction(() => { const t = document.querySelector('#gasAcct').textContent; return t && !/testen/.test(t); }, null, { timeout: 10000 });
    return text('#gasAcct');
  };
  ok((await tryLink(gasBase + '?key=fout')).includes('sleutel onjuist'), 'verkeerde sleutel: duidelijke melding');
  ok((await tryLink(gasBase.replace('/exec', '/login') + '?key=x')).includes('Iedereen'), 'link die om inloggen vraagt: uitleg over toegang "Iedereen"');
  const good = await tryLink(gasBase + '?key=' + gas.props.KEY);
  ok(good.includes('4 afspraken met projectcode'), 'goede link: afspraken opgehaald (ander domein)');
  ok(good.includes('Verbonden met jorg@werk.nl'), 'koppeling toont het werkaccount');
  ok((await text('#viaHint')).includes('klaar in Gmail van jorg@werk.nl'), 'versturen staat op Gmail van het werkaccount');
  await page.click('#setDone');
  await page.setInputFiles('#camInput', path.join(here, 'photo-lunch.jpg'));
  await page.waitForSelector('#editor:not([hidden])'); await settle();
  ok(await val('#inProject') === 'KLMN2041', 'bon van 8 okt krijgt project uit werkagenda');

  console.log('Versturen via Gmail');
  await page.click('#edDeclare'); await page.waitForSelector('#sendWrap:not([hidden])');
  await page.waitForFunction(() => !document.querySelector('#sendShare').disabled, null, { timeout: 15000 });
  ok((await text('#sendShareLabel')) === 'Zet klaar in Gmail' && (await text('#sendSteps')).includes('jorg@werk.nl') && await page.$eval('#sendMailto', e => e.hidden), 'knop en uitleg voor Gmail, geen kopieerstappen');
  ok(await page.$$eval('.copy[data-copy]', bs => bs.every(b => b.hidden)), 'geen kopieerknoppen in Gmail-modus');
  await page.click('#sendShare');
  await page.waitForSelector('#sendDone:not([hidden])', { timeout: 10000 });
  const dr = gas.out.drafts.pop();
  ok(dr && dr.to === 'administratie@bedrijf.nl' && dr.subject.startsWith('Declaratie KLMN2041') && dr.body.includes('Totaal te vergoeden') && dr.body.includes('Sanne de Vries'), 'concept met adres, onderwerp en tekst in Gmail');
  ok(dr && dr.options.attachments.length === 1 && dr.options.attachments[0].type === 'image/jpeg' && dr.options.attachments[0].bytes.length > 20000, 'foto als bijlage in het concept (' + (dr ? dr.options.attachments[0].bytes.length : 0) + ' bytes)');
  ok(/^text\/plain/.test(gasPosts[gasPosts.length - 1] || ''), 'eenvoudig verzoek (text/plain), zoals Google het vereist');
  ok((await text('#gmailDoneText')).includes('van jorg@werk.nl') && (await page.getAttribute('#openGmailWeb', 'href')).includes('/u/jorg%40werk.nl/#drafts') && (await page.getAttribute('#openGmailApp', 'href')).startsWith('googlegmail:'), 'knoppen naar Gmail-app en Gmail-concepten');
  await page.screenshot({ path: path.join(out, 'web-gmail.png') });
  await page.click('#sendNotYet');
  gas.out.gmailFails = true;
  await page.click('#sendShare'); await page.waitForTimeout(600);
  ok((await text('#toast')).includes('Gmail weigerde') && await page.$eval('#sendDone', e => e.hidden), 'Gmail-fout: duidelijke melding, niet als verstuurd gemarkeerd');
  gas.out.gmailFails = false;
  await page.fill('#mTo', 'geen-adres'); await page.click('#sendShare'); await page.waitForTimeout(200);
  ok((await text('#toast')).includes('adres'), 'ongeldig adres eerst in de app opgevangen');
  await page.fill('#mTo', 'administratie@bedrijf.nl');
  await page.click('#sendClose');
  await page.click('#openSettings'); await page.click('#sendVia [data-via=share]'); await page.click('#setDone');
  await page.click('#list .row >> nth=0'); await page.waitForSelector('#editor:not([hidden])');
  await page.click('#edDeclare'); await page.waitForSelector('#sendWrap:not([hidden])');
  ok((await text('#sendShareLabel')) === 'Verstuur via Mail' && await page.$$eval('.copy[data-copy]', bs => bs.every(b => !b.hidden)), 'terugschakelen naar deelmenu werkt');
  await page.click('#sendClose');
  await page.click('#openSettings'); await page.click('#sendVia [data-via=gmail]'); await page.click('#setDone');
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
  const before = { rows: (await page.$$('#list .row')).length, total: await text('#summary .big') };
  offline = true; await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => /telefoon/.test(document.querySelector('#storageNote').textContent), null, { timeout: 10000 }).catch(() => {});
  ok((await page.$$('#list .row')).length === before.rows && (await text('#summary .big')) === before.total, `app opent zonder internet, gegevens bewaard (${before.rows} open, ${before.total})`);
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

  console.log('Online bewaren: iPhone en computer');
  gasImpl = require('./gas-harness.cjs').run('');
  gasImpl.ctx.doGet({ parameter: { key: 'x' } });
  const link = gasBase + '?key=' + gasImpl.props.KEY;
  const drive = gasImpl.out.drive;
  const index = () => { const f = drive.files.find(x => x.name === 'bonnen.json'); return f ? JSON.parse(Buffer.from(f.bytes).toString()).recs : {}; };
  const live = () => Object.values(index()).filter(r => !r.deleted);
  const until = async (fn, what, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } console.log('    wachten op: ' + what); return false; };
  const connect = async pg => {
    await pg.click('#openSettings');
    await pg.fill('#sGasUrl', link); await pg.dispatchEvent('#sGasUrl', 'change');
    await pg.click('#setDone');
  };
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await phone.goto(url); await phone.waitForFunction(() => /telefoon/.test(document.querySelector('#storageNote').textContent));
  await connect(phone);
  await phone.setInputFiles('#libInput', path.join(here, 'photo-lunch.jpg'));
  await phone.waitForSelector('#editor:not([hidden])');
  await phone.waitForFunction(() => !document.querySelector('#edStatus .spin'), null, { timeout: 90000 });
  await phone.click('#edSave'); await phone.waitForSelector('#editor', { state: 'hidden' });
  ok(await until(() => live().length === 1 && drive.files.some(f => /^bon-.*\.jpg$/.test(f.name) && !f.trashed) && live()[0].drivePhoto, 'bon en foto in Drive'), 'iPhone: nieuwe bon met foto staat in Drive');
  await phone.waitForFunction(() => /Google Drive/.test(document.querySelector('#storageNote').textContent));
  ok(true, 'iPhone meldt "Bewaard in je Google Drive"');

  const pcCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  const pc = await pcCtx.newPage();
  pc.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await pc.goto(url); await pc.waitForFunction(() => /telefoon/.test(document.querySelector('#storageNote').textContent));
  ok((await pc.$$('#list .row')).length === 0, 'computer begint leeg');
  await connect(pc);
  await pc.waitForFunction(() => document.querySelectorAll('#list .row').length === 1, null, { timeout: 15000 }).catch(() => {});
  ok((await pc.$$('#list .row')).length === 1 && (await pc.$eval('#list .row .t', e => e.textContent)) === 'Lunch', 'computer: bon van de iPhone verschijnt na koppelen');
  await pc.waitForFunction(() => { const i = document.querySelector('#list .row .thumb img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
  ok(await pc.$eval('#list .row .thumb', t => { const i = t.querySelector('img'); return !!(i && i.naturalWidth > 0); }), 'computer: foto komt uit Drive');
  await pc.screenshot({ path: path.join(out, 'web-computer.png') });

  await pc.click('#list .row'); await pc.waitForSelector('#editor:not([hidden])');
  await pc.fill('#inDesc', 'Lunch met klant'); await pc.fill('#inProject', 'KLMN2041'); await pc.dispatchEvent('#inProject', 'input');
  await pc.click('#edSave'); await pc.waitForSelector('#editor', { state: 'hidden' });
  ok(await until(() => live()[0] && live()[0].description === 'Lunch met klant', 'wijziging computer in Drive'), 'computer: wijziging gaat naar Drive');
  await phone.reload(); await phone.waitForFunction(() => document.querySelector('#list .row .t')?.textContent === 'Lunch met klant', null, { timeout: 15000 }).catch(() => {});
  ok((await phone.$eval('#list .row .t', e => e.textContent)) === 'Lunch met klant' && (await phone.$eval('#list .row .chip', e => e.textContent)) === 'KLMN2041', 'iPhone: ziet de wijziging van de computer');

  await phoneCtx.setOffline(true);
  await phone.click('#list .row'); await phone.waitForSelector('#editor:not([hidden])');
  await phone.fill('#inAmount', '24,75'); await phone.click('#edSave'); await phone.waitForSelector('#editor', { state: 'hidden' });
  ok((await phone.$eval('#list .row .amt', e => e.textContent)).includes('24,75') && live()[0].amount === 23.5, 'iPhone zonder internet: wijziging bewaard op de telefoon');
  await phoneCtx.setOffline(false);
  await phone.evaluate(() => dispatchEvent(new Event('online')));
  ok(await until(() => live()[0] && live()[0].amount === 24.75, 'wijziging na online'), 'weer online: wijziging gaat alsnog naar Drive');

  await phone.click('#list .row'); await phone.waitForSelector('#editor:not([hidden])');
  await phone.click('#edDeclare'); await phone.waitForSelector('#sendWrap:not([hidden])');
  await phone.waitForFunction(() => !document.querySelector('#sendShare').disabled, null, { timeout: 15000 });
  await phone.fill('#mTo', 'administratie@bedrijf.nl');
  await phone.click('#sendShare'); await phone.waitForSelector('#sendDone:not([hidden])', { timeout: 10000 });
  await phone.click('#sendMark');
  ok(await until(() => live()[0] && live()[0].status === 'sent', 'verstuurd in Drive'), 'iPhone: verstuurd gemarkeerd, ook in Drive');
  await phone.click('#openSettings');
  ok(await phone.$eval('#sGasUrl', e => e.value) === link && await phone.$eval('#sEmail', e => e.value) === 'administratie@bedrijf.nl', 'versturen na herstart wist geen instellingen (koppeling blijft staan)');
  await phone.click('#setDone');
  await pc.reload(); await pc.click('#tabSent');
  await pc.waitForFunction(() => document.querySelectorAll('#list .row').length === 1, null, { timeout: 15000 }).catch(() => {});
  ok((await pc.$$('#list .row')).length === 1, 'computer: bon staat bij Verstuurd');

  await pc.click('#list .row'); await pc.waitForSelector('#editor:not([hidden])');
  await pc.click('#edDelete'); await pc.click('#edDeleteYes');
  ok(await until(() => live().length === 0 && !drive.files.some(f => /^bon-/.test(f.name) && !f.trashed), 'verwijderd in Drive'), 'computer: verwijderen haalt bon en foto uit Drive');
  await phone.reload(); await phone.click('#tabSent');
  await phone.waitForFunction(() => document.querySelectorAll('#list .row').length === 0, null, { timeout: 15000 }).catch(() => {});
  ok((await phone.$$('#list .row')).length === 0, 'iPhone: verwijderde bon is ook daar weg');

  gasOld = true;
  await pc.click('#openSettings'); await pc.click('#cloudNow');
  await pc.waitForFunction(() => !/Bijwerken…/.test(document.querySelector('#cloudResult').textContent), null, { timeout: 10000 });
  ok((await pc.$eval('#cloudResult', e => e.textContent)).includes('nieuwste versie van het script'), 'oud script: duidelijke melding om bij te werken');
  gasOld = false;
  await pc.click('#cloudNow');
  await pc.waitForFunction(() => /online · bijgewerkt/.test(document.querySelector('#cloudResult').textContent), null, { timeout: 10000 }).catch(() => {});
  ok((await pc.$eval('#cloudResult', e => e.textContent)).startsWith('0 bonnen online'), 'instellingen tonen stand van online bewaren');
  await pc.$eval('#cloudResult', e => e.scrollIntoView({ block: 'center' }));
  await pc.screenshot({ path: path.join(out, 'web-cloud-settings.png') });
  await phoneCtx.close(); await pcCtx.close();
  fs.rmSync(path.join(site, 'agenda.enc'), { force: true });
  console.log('\nFouten in console: ' + (errors.length ? '\n' + errors.join('\n') : 'geen'));
  console.log(`\n${pass} geslaagd, ${fail} mislukt`);
  if (fail) console.log('Mislukt:\n- ' + failures.join('\n- '));
  await browser.close(); server.close(); gasServer.close();
  process.exit(fail ? 1 : 0);
})();
