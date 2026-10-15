# Declaratie-app

Maak een foto van een bon. De app leest bedrag en datum uit, zoekt in je werkagenda het project (4 letters + 4 cijfers, bijv. `ABCD1234`) en zet de declaratie met de foto als bijlage klaar in Gmail.

**App:** https://jorglbl.github.io/Declaratie-app/. Open de link in Safari op je iPhone → deelknop → **Zet op beginscherm**.

## Gebruik

1. **Scan bon**: maak een foto, of kies er een met het fotoknopje.
2. Controleer de velden. Wat de app zelf heeft ingevuld, heeft het label ✦ gelezen.
3. Het project komt uit je agenda. Staan er meerdere op die dag, tik dan het juiste aan.
4. **Declareer** → **Zet klaar in Gmail**. Open Gmail → Concepten → controleer en verstuur. Meerdere bonnen gaan samen in één pdf.
5. Tik op **Ja, verstuurd**. De bon gaat naar **Verstuurd**.

## Google-werkaccount koppelen (eenmalig, op een computer)

Een klein script in je werkaccount zet de mails klaar in Gmail, met je werkadres als afzender, en geeft de app je werkagenda door.

1. Ga naar **script.google.com**, ingelogd met je werkaccount → **Nieuw project**.
2. Vervang de voorbeeldcode door de inhoud van [`tools/apps-script/Code.gs`](tools/apps-script/Code.gs) → **Opslaan**.
3. Klik links naast **Services** op **+** → **Google Calendar API** → **Toevoegen**.
4. Kies bovenin de functie **test** → **Uitvoeren** → sta toegang tot agenda en Gmail toe. Het logboek toont na enkele seconden hoeveel afspraken met projectcode er zijn gevonden.
5. **Implementeren → Nieuwe implementatie** → tandwiel → **Web-app**. Kies:
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen**

   Klik daarna op **Implementeren** en kopieer de URL van de web-app.
6. Open die URL in je browser. Je ziet je **koppeling**. Stuur die naar je iPhone, bijvoorbeeld via Notities, en deel hem met niemand anders.
7. In de app: **Instellingen → Google-werkaccount** → plak de koppeling → **Test koppeling**. Kies bij **Werkagenda** voor **Google (werk)**.

**Blijft "Uitvoering gestart" geel staan?** Dan wacht Google op je toestemming. Zoek het venster **Autorisatie vereist**: het kan achter je browser staan of als pop-up geblokkeerd zijn. Kies daar **Geavanceerd → Ga naar … (onveilig) → Toestaan**. Er staat "onveilig" omdat het je eigen script is.

**Staat "Iedereen" er niet?** Kies dan **Alleen ikzelf**. De app verstuurt dan via het deelmenu in plaats van Gmail. Voor je agenda kopieer je de **agenda-code** van de pagina uit stap 6 naar Werkagenda → Google (werk). Herhaal dat af en toe.

**Script bijwerken:** plak de nieuwe code en sla op. Ga dan naar **Implementeren → Implementaties beheren** → potlood → Versie: **Nieuwe versie** → **Implementeren**. De koppeling blijft hetzelfde.

Het script maakt alleen concepten. Versturen doe je altijd zelf. Van je agenda geeft het alleen afspraken met een projectcode door. Is je koppeling uitgelekt? Verwijder in het script bij **Projectinstellingen → Scripteigenschappen** de eigenschap `KEY`. De pagina uit stap 6 geeft dan een nieuwe koppeling.

## Wachtwoord op de app

1. GitHub → **Settings → Secrets and variables → Actions → New repository secret**.
2. Name: `APP_PASSWORD`, Secret: een zelfgekozen wachtwoord van minstens 12 tekens.
3. **Actions → Web-app publiceren → Run workflow**.

Op je iPhone vul je het wachtwoord één keer in, met **Onthoud op deze iPhone** aangevinkt. Wil je het wijzigen? Pas het geheim aan en draai de workflow opnieuw.

## Overig

- **Agenda zonder script:** lees een .ics-bestand in via **Werkagenda → Bestand (.ics)**. Heb je een iCal-link van je agenda? Zet die dan als geheim `AGENDA_ICS_URL` in GitHub. GitHub haalt de agenda dan elk uur op en versleutelt hem met je `APP_PASSWORD`. In de app kies je **Werkagenda → Via GitHub → Agenda ophalen**.
- **Claude-versie:** dezelfde app staat ook als artifact in Claude. Daar leest Claude de bon en komt de agenda uit je Google Agenda.
- **Publiceren:** elke wijziging op `main` zet GitHub Actions automatisch online (GitHub Pages).

## Code

- `src/app.html`, `src/lib.js`: de app en de gedeelde regels (projectcodes, agenda, bon-tekst).
- `tools/build.mjs`: bouwt `site/` (web-app) en `dist/artifact.html` (Claude-versie).
- `tools/apps-script/Code.gs`: script voor het Google-werkaccount.
- `tools/agenda-sync.mjs`: haalt en versleutelt de iCal-agenda (GitHub Actions).
- `web/`: icoon, manifest, offline-ondersteuning en meegeleverde bibliotheken (zie `web/vendor/LICENSES.md`).
- Tests: `node test/lib.test.cjs` en `node test/apps-script.test.cjs`. Na `node tools/build.mjs` met Playwright: `node test/web.e2e.cjs` en `node test/e2e.cjs`.
