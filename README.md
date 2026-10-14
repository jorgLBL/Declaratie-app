# Declaratie-app

Maak een foto van een bon. De app leest bedrag, datum, winkel en omschrijving uit en zoekt in je werkagenda het project (4 letters + 4 cijfers, bijv. `ABCD1234`). Daarna verstuur je de declaratie naar de administratie, met de foto als bijlage.

Er zijn twee versies uit dezelfde code:

| | Gratis web-app (iPhone-beginscherm) | Claude-versie |
|---|---|---|
| Bon uitlezen | op de telefoon zelf (tekstherkenning) | door Claude |
| Agenda | automatisch via GitHub, of een .ics-bestand | Google Agenda |
| Opslag | op de telefoon | in je Claude-account |
| Mailen | deelmenu: foto + tekst in één keer naar Mail | deelmenu + tekst plakken |
| Kosten | gratis, geen account nodig | Claude-abonnement |

## Gratis web-app op je iPhone zetten (eenmalig)

1. GitHub → dit project → **Settings → General → Change visibility → Public**. (Gratis publiceren kan alleen vanuit een openbaar project. In de code staan geen persoonlijke gegevens; je bonnen blijven op je telefoon.)
2. **Settings → Pages → Source: GitHub Actions**.
3. Zet de code op `main` (merge deze branch). GitHub bouwt de app; na een paar minuten staat hij op `https://jorglbl.github.io/Declaratie-app/`.
4. Open die link in **Safari** op je iPhone → deelknop → **Zet op beginscherm**.

### Agenda automatisch laten bijwerken (optioneel)

GitHub haalt dan elk uur je werkagenda op, bewaart alleen afspraken met een projectcode en versleutelt die met jouw wachtwoord.

1. Zoek de agenda-link:
   - Google Agenda (computer): Instellingen → je werkagenda → **Geheim adres in iCal-indeling**.
   - Outlook (web): Instellingen → Agenda → Gedeelde agenda's → **Een agenda publiceren** → ICS-link.
2. GitHub → **Settings → Secrets and variables → Actions → New repository secret**:
   - `AGENDA_ICS_URL`: de link uit stap 1
   - `AGENDA_PASSWORD`: een wachtwoord dat je zelf kiest
3. In de app: Instellingen → Werkagenda → **Automatisch** → vul hetzelfde wachtwoord in → **Agenda ophalen**.

Zonder deze stap kun je in de app ook een .ics-bestand inlezen (Instellingen → Werkagenda → Bestand).
GitHub zet het elk uur bijwerken uit als er 60 dagen niets aan het project verandert; je krijgt dan een mail met een knop om het weer aan te zetten.

## Gebruik

1. **Scan bon**: maak een foto, of kies er een met het fotoknopje.
2. Controleer de velden. Wat automatisch is ingevuld, heeft het label ✦ gelezen.
3. Het project komt uit je agenda op de datum van de bon. Staan er meerdere op die dag, tik dan het juiste aan. Je kunt de code ook typen of een recent project kiezen.
4. **Declareer** → **Verstuur via Mail** → kies Mail en vul het adres in. Meerdere bonnen gaan samen in één pdf.
5. Bevestig dat de mail verstuurd is; de bon gaat naar **Verstuurd**.

## Code

- `src/app.html`, `src/lib.js`: de app en de gedeelde regels (projectcodes, agenda, bon-tekst).
- `tools/build.mjs`: bouwt `site/` (web-app) en `dist/artifact.html` (Claude-versie).
- `tools/agenda-sync.mjs`: haalt en versleutelt de agenda (draait in GitHub Actions).
- `web/`: icoon, manifest, offline-ondersteuning en meegeleverde bibliotheken (zie `web/vendor/LICENSES.md`).
- Tests: `node test/lib.test.cjs`, en na `node tools/build.mjs` met Playwright `node test/web.e2e.cjs` en `node test/e2e.cjs`.
