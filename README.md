# Declaratie-app

Maak een foto van een bon. De app leest bedrag, datum, winkel en omschrijving uit en zoekt in je werkagenda het project (4 letters + 4 cijfers, bijv. `ABCD1234`). Daarna verstuur je de declaratie naar de administratie, met de foto als bijlage.

Er zijn twee versies uit dezelfde code:

| | Gratis web-app (iPhone-beginscherm) | Claude-versie |
|---|---|---|
| Bon uitlezen | op de telefoon zelf (tekstherkenning) | door Claude |
| Agenda | Google-werkagenda via een eigen script, via GitHub, of een .ics-bestand | Google Agenda |
| Opslag | op de telefoon | in je Claude-account |
| Mailen | deelmenu: foto + tekst in één keer naar Mail | deelmenu + tekst plakken |
| Kosten | gratis, geen account nodig | Claude-abonnement |

## Gratis web-app op je iPhone zetten (eenmalig)

1. GitHub → dit project → **Settings → General → Change visibility → Public**. (Gratis publiceren kan alleen vanuit een openbaar project. In de code staan geen persoonlijke gegevens; je bonnen blijven op je telefoon.)
2. **Settings → Pages → Source: GitHub Actions**.
3. Zet de code op `main` (merge deze branch). GitHub bouwt de app; na een paar minuten staat hij op `https://jorglbl.github.io/Declaratie-app/`.
4. Open die link in **Safari** op je iPhone → deelknop → **Zet op beginscherm**.

### Wachtwoord op de app

Zonder wachtwoord kan iedereen met de link de app openen. Je bonnen zien ze dan niet (die staan alleen op jouw telefoon), maar ze kunnen de app wel gebruiken. Zo zet je er een wachtwoord op:

1. GitHub → **Settings → Secrets and variables → Actions → New repository secret**.
2. Name: `APP_PASSWORD`, Secret: een wachtwoord dat je zelf kiest. Kies er een van minstens 12 tekens.
3. **Actions → Web-app publiceren → Run workflow**. Na een paar minuten vraagt de app om het wachtwoord.

Op je iPhone vul je het één keer in; met **Onthoud op deze iPhone** blijft de app daarna open. Via Instellingen → Beveiliging vergrendel je hem weer. Het wachtwoord zelf staat nergens in de app of op GitHub zichtbaar, alleen een versleutelde vingerafdruk ervan. Wijzigen gaat door het geheim aan te passen en de workflow opnieuw te draaien.

### Google-werkagenda koppelen (als je werk het geheime iCal-adres uitzet)

Een klein script in je eigen werkaccount leest je agenda en geeft alleen afspraken met een projectcode door. Je hebt er geen beheerder voor nodig. Doe dit op een computer:

1. Ga naar **script.google.com**, ingelogd met je **werkaccount** → **Nieuw project**.
2. Wis de voorbeeldcode en plak de inhoud van [`tools/apps-script/Code.gs`](tools/apps-script/Code.gs). Klik op **Opslaan** (diskette-icoon).
3. Kies bovenin de functie **test** en klik op **Uitvoeren**. Geef toegang tot je agenda als Google daarom vraagt. Onderaan staat dan hoeveel afspraken met projectcode er zijn gevonden.
4. **Implementeren → Nieuwe implementatie** → bij "Type selecteren" (tandwiel) **Web-app**:
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen** (staat die keuze er niet, kies dan **Alleen ikzelf** en gebruik stap 6b)
   - **Implementeren** → kopieer de **URL van de web-app**.
5. Open die URL in je browser (ingelogd met je werkaccount). Je ziet een pagina met je **app-link** en een **agenda-code**.
6. In de app: Instellingen → Werkagenda → **Google (werk)**:
   - a. Plak de **app-link** bij Agenda-link → **Agenda ophalen**. De app werkt de agenda dan zelf bij. Stuur de link naar je iPhone via bijvoorbeeld Notities of een mail aan jezelf; deel hem verder met niemand.
   - b. Werkt de link niet (de app meldt dat hij om inloggen vraagt)? Kopieer dan de **agenda-code** en plak die bij Agenda-code → **Code inlezen**. Herhaal dit af en toe, bijvoorbeeld eens per maand, om nieuwe afspraken mee te nemen.

Het script stuurt alleen datum, tijd, titel en projectcode van afspraken met een projectcode. Afspraken die je hebt afgeslagen tellen niet mee. Wil je de link ongeldig maken: verwijder in het script bij **Projectinstellingen → Scripteigenschappen** de eigenschap `KEY`; de pagina uit stap 5 geeft dan een nieuwe link.

### Agenda automatisch laten bijwerken via GitHub (optioneel)

GitHub haalt dan elk uur je werkagenda op, bewaart alleen afspraken met een projectcode en versleutelt die met jouw wachtwoord.

1. Zoek de agenda-link:
   - Google Agenda (computer): Instellingen → je werkagenda → **Geheim adres in iCal-indeling**.
   - Outlook (web): Instellingen → Agenda → Gedeelde agenda's → **Een agenda publiceren** → ICS-link.
2. GitHub → **Settings → Secrets and variables → Actions → New repository secret**:
   - `AGENDA_ICS_URL`: de link uit stap 1
   - De agenda wordt versleuteld met je `APP_PASSWORD` (zie hierboven). Wil je een apart agenda-wachtwoord, voeg dan ook `AGENDA_PASSWORD` toe.
3. In de app: Instellingen → Werkagenda → **Automatisch** → **Agenda ophalen**. Het wachtwoordveld laat je leeg, tenzij je een apart agenda-wachtwoord hebt.

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
- `tools/apps-script/Code.gs`: script voor de Google-werkagenda.
- Tests: `node test/lib.test.cjs`, `node test/apps-script.test.cjs`, en na `node tools/build.mjs` met Playwright `node test/web.e2e.cjs` en `node test/e2e.cjs`.
