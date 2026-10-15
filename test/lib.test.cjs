// Unit checks for src/lib.js (codes, .ics, receipt text). Run: node test/lib.test.cjs
process.env.TZ = 'Europe/Amsterdam'; // de verwachte tijden hieronder zijn Nederlandse tijd
const L = require('../src/lib.js');
let pass = 0, fail = 0;
const eq = (a, b, name) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : `\n      kreeg ${JSON.stringify(a)}\n      verwacht ${JSON.stringify(b)}`)); };

console.log('Projectcodes');
eq(L.findCodes('Overleg ABCD1234 en abcd-1234, RTSV_3310'), ['ABCD1234', 'RTSV3310'], 'codes met streepje/underscore, dubbel 1x');
eq(L.findCodes('Week 2026, jaar2026x, ABCDE1234, ABCD12345'), [], 'geen valse treffers');

console.log('.ics');
const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:w1
DTSTART;TZID=Europe/Amsterdam:20260907T090000
DTEND;TZID=Europe/Amsterdam:20260907T100000
RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261031T000000Z
EXDATE;TZID=Europe/Amsterdam:20261008T090000
SUMMARY:Bouwteam KLMN2041
BEGIN:VALARM
TRIGGER:-PT15M
DESCRIPTION:Reminder ZZZZ9999
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:w1
RECURRENCE-ID;TZID=Europe/Amsterdam:20261012T090000
DTSTART;TZID=Europe/Amsterdam:20261013T140000
DTEND;TZID=Europe/Amsterdam:20261013T150000
SUMMARY:Bouwteam KLMN2041 (verzet)
END:VEVENT
BEGIN:VEVENT
UID:m1
DTSTART;VALUE=DATE:20260908
DURATION:P1D
RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3
SUMMARY:Maandoverleg PQRS5555
END:VEVENT
BEGIN:VEVENT
UID:c1
DTSTART:20261009T070000Z
DTEND:20261009T080000Z
STATUS:CANCELLED
SUMMARY:Afgezegd ABCD1234
END:VEVENT
BEGIN:VEVENT
UID:n1
DTSTART:20261009T230000Z
DTEND:20261010T003000Z
SUMMARY:Nachtwerk WXYZ1111
END:VEVENT
END:VCALENDAR`;
const ev = L.parseIcs(ics, { today: '2026-10-14' });
const on = d => ev.filter(e => e.s <= d && d <= e.e).map(e => e.code + ' ' + e.time);
eq(ev.filter(e => e.code === 'KLMN2041').map(e => e.s), ['2026-09-07','2026-09-10','2026-09-14','2026-09-17','2026-09-21','2026-09-24','2026-09-28','2026-10-01','2026-10-05','2026-10-13','2026-10-15','2026-10-19','2026-10-22','2026-10-26','2026-10-29'], 'wekelijks ma+do, EXDATE 8 okt weg, 12 okt verzet naar 13 okt, tot 31 okt');
eq(on('2026-10-13'), ['KLMN2041 14:00–15:00', 'PQRS5555 hele dag'], 'verzette afspraak met eigen tijd (+ maandoverleg)');
eq(ev.filter(e => e.code === 'PQRS5555').map(e => e.s), ['2026-09-08', '2026-10-13', '2026-11-10'], 'maandelijks 2e dinsdag, 3 keer');
eq(on('2026-10-09').length, 0, 'geannuleerde afspraak overgeslagen; UTC 23:00 is 01:00 lokaal volgende dag');
eq(on('2026-10-10'), ['WXYZ1111 01:00–02:30'], 'UTC-tijd omgerekend naar lokale tijd (TZ=' + (process.env.TZ || 'systeem') + ')');
eq(ev.some(e => e.code === 'ZZZZ9999'), false, 'tekst in herinnering (VALARM) telt niet');

console.log('Bon-tekst');
const t1 = `BAGELS & BEANS
Neude 30 Utrecht
08-10-26 12:41
Bagel zalm 9,25
Bagel kip 8,75
Cappuccino 3,40
Thee 2,1O
Subtotaal 23,50
TOTAAL 23,5O
PIN 23,50
BTW 9% 1,94`;
eq(L.parseReceipt(t1, '2026-10-14'), { total: 23.5, date: '2026-10-08', merchant: 'Bagels & Beans', description: 'Lunch', category: 'Maaltijd', confident: true }, 'horeca-bon');
const t2 = `Q-PARK
Parkeergarage Jaarbeurs
Datum: 09/10/2026 Tijd 08:12
Parkeerduur 3u 12m
Te betalen EUR 18,90
Betaald met Maestro
Wisselgeld 0,00`;
eq(L.parseReceipt(t2, '2026-10-14'), { total: 18.9, date: '2026-10-09', merchant: 'Q-Park', description: 'Parkeren', category: 'Parkeren', confident: true }, 'parkeerbon "Te betalen EUR"');
const t3 = `Shell Utrecht A12
Pomp 4 Euro 95
42,18 L x 2,019
85,16
Totaal
€ 85,16
Btw 21% 14,78
12 okt 2026`;
eq(L.parseReceipt(t3, '2026-10-14'), { total: 85.16, date: '2026-10-12', merchant: 'Shell', description: 'Brandstof', category: 'Reiskosten', confident: true }, 'tankbon: bedrag op volgende regel, maandnaam');
const t4 = `Bouwmarkt De Wit
schroeven 4x40 3,99
pluggen 2,49
kit 7,95
1.234,50 afgerond
2026-10-11`;
const r4 = L.parseReceipt(t4, '2026-10-14');
eq([r4.total, r4.date, r4.merchant, r4.category, r4.confident], [1234.5, '2026-10-11', 'Bouwmarkt De Wit', 'Materiaal', false], 'zonder totaal-woord: grootste bedrag, niet zeker');
eq(L.parseReceipt('31-12-2030 9,99', '2026-10-14').date, null, 'datum in de toekomst genegeerd');

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
process.exit(fail ? 1 : 0);
