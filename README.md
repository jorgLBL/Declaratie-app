# Declaratie-app

Maak een foto van een bon. De app leest bedrag, datum, winkel en omschrijving uit en zoekt in je werkagenda het project (4 letters + 4 cijfers, bijv. `ABCD1234`). Daarna verstuur je de declaratie naar de administratie, met de foto als bijlage.

Er zijn twee versies uit dezelfde code:

| | Gratis web-app (iPhone-beginscherm) | Claude-versie |
|---|---|---|
| Bon uitlezen | op de telefoon zelf (tekstherkenning) | door Claude |
| Agenda | Google-werkagenda via een eigen script, via GitHub, of een .ics-bestand | Google Agenda |
| Opslag | op de telefoon | in je Claude-account |
| Mailen | nieuwe e-mail met bijlage klaar in Gmail (werkaccount), of via het deelmenu | deelmenu + tekst plakken |
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

### Google-werkaccount koppelen (Gmail en werkagenda)

Een klein script in je eigen werkaccount doet twee dingen voor de app:
- het zet je declaratie als **nieuwe e-mail met bijlage klaar in Gmail**, met je werkadres als afzender. Jij opent het concept en verstuurt het;
- het geeft je **werkagenda** door (alleen afspraken met een projectcode). Dat werkt ook als je werk het geheime iCal-adres heeft uitgezet.

Je hebt er geen beheerder voor nodig. Doe dit op een computer:

1. Ga naar **script.google.com**, ingelogd met je **werkaccount** → **Nieuw project**.
2. Wis de voorbeeldcode en plak de inhoud van [`tools/apps-script/Code.gs`](tools/apps-script/Code.gs). Klik op **Opslaan** (diskette-icoon).
3. Klik links naast **Services** op **+**, kies **Google Calendar API** en klik op **Toevoegen**. Daarmee haalt het script je agenda in één keer op in plaats van afspraak voor afspraak.
4. Kies bovenin de functie **test** en klik op **Uitvoeren**. Google vraagt toegang tot je **agenda** en **Gmail**: sta beide toe. Na enkele seconden staat in het uitvoeringslogboek hoeveel afspraken met projectcode er zijn gevonden, hoe lang dat duurde en vanaf welk adres mails worden klaargezet.
5. **Implementeren → Nieuwe implementatie** → bij "Type selecteren" (tandwiel) **Web-app**:
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen**
   - **Implementeren** → kopieer de **URL van de web-app**.
6. Open die URL in je browser (ingelogd met je werkaccount). Je ziet een pagina met je **koppeling** (een link) en een **agenda-code**.
7. Stuur de koppeling naar je iPhone, bijvoorbeeld via Notities of een mail aan jezelf. Deel hem verder met niemand.
8. In de app: Instellingen → **Google-werkaccount** → plak de link bij Koppeling → **Test koppeling**. Je ziet "Verbonden met" je werkadres.
9. Instellingen → **Versturen** staat dan op **Gmail (werkaccount)**, en bij Werkagenda kies je **Google (werk)**.

**Staat de keuze "Iedereen" er niet** (je werk staat dat niet toe)? Kies dan **Alleen ikzelf**. De app kan dan geen mails klaarzetten en verstuurt via het deelmenu. Voor je agenda kopieer je de **agenda-code** van de pagina uit stap 6 en plak je die in de app bij Werkagenda → Google (werk). Herhaal dat af en toe om nieuwe afspraken mee te nemen.

**Blijft "Uitvoering gestart" geel staan?**
- Kijk of er een venster **Autorisatie vereist** openstaat, eventueel achter je browservenster of geblokkeerd als pop-up. Kies je werkaccount, dan **Geavanceerd → Ga naar … (onveilig)** en **Toestaan**. Dat "onveilig" staat er omdat het je eigen, niet door Google gecontroleerde script is.
- Heb je stap 3 overgeslagen? Dan leest het script afspraak voor afspraak en kan dat bij een volle agenda minuten duren. Voeg de dienst Google Calendar API toe en voer **test** opnieuw uit; het duurt dan enkele seconden.

**Script al eerder ingesteld?** Plak de nieuwe versie van `Code.gs`, sla op, voeg de dienst **Google Calendar API** toe als die er nog niet staat, voer **test** opnieuw uit (sta Gmail toe) en kies **Implementeren → Implementaties beheren** → potlood → Versie: **Nieuwe versie** → **Implementeren**. De link blijft hetzelfde.

Het script maakt alleen **concepten**; versturen doe je altijd zelf in Gmail. Zo kan ook iemand die je link te pakken krijgt geen mail namens jou versturen. Het geeft van je agenda alleen datum, tijd, titel en projectcode van afspraken met een projectcode door; afgeslagen afspraken tellen niet mee. Link ongeldig maken: verwijder in het script bij **Projectinstellingen → Scripteigenschappen** de eigenschap `KEY`; de pagina uit stap 6 geeft dan een nieuwe link.

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
4. **Declareer** → **Zet klaar in Gmail**. Open Gmail, tik bij Concepten op de e-mail en verstuur. Meerdere bonnen gaan samen in één pdf. (Zonder Google-koppeling: **Verstuur via Mail** → kies Mail en vul het adres in.)
5. Bevestig dat de mail verstuurd is; de bon gaat naar **Verstuurd**.

## Code

- `src/app.html`, `src/lib.js`: de app en de gedeelde regels (projectcodes, agenda, bon-tekst).
- `tools/build.mjs`: bouwt `site/` (web-app) en `dist/artifact.html` (Claude-versie).
- `tools/agenda-sync.mjs`: haalt en versleutelt de agenda (draait in GitHub Actions).
- `web/`: icoon, manifest, offline-ondersteuning en meegeleverde bibliotheken (zie `web/vendor/LICENSES.md`).
- `tools/apps-script/Code.gs`: script voor het Google-werkaccount (Gmail-concepten en werkagenda).
- Tests: `node test/lib.test.cjs`, `node test/apps-script.test.cjs`, en na `node tools/build.mjs` met Playwright `node test/web.e2e.cjs` en `node test/e2e.cjs`.
