# Declaratie-app

Maak een foto van een bon. De app leest bedrag, datum, winkel en omschrijving uit en zoekt in je werkagenda het project (4 letters + 4 cijfers, bijv. `ABCD1234`). Daarna verstuur je de declaratie naar de administratie, met de foto als bijlage.

- `app/declaratie-app.html`: de app (draait als Claude-artifact, ook op de iPhone in de Claude-app).
- `test/`: lokale test met een nagebootste omgeving (`node test/run.cjs <map> light|dark`, met Playwright).

## Gebruik

1. **Scan bon**: maak een foto, of kies er een met het fotoknopje.
2. Controleer de velden. Wat automatisch is ingevuld, heeft het label ✦ gelezen.
3. Het project komt uit je agenda op de datum van de bon. Staan er meerdere op die dag, tik dan het juiste aan. Je kunt de code ook typen of een recent project kiezen.
4. **Declareer**: de mailtekst wordt gekopieerd en het deelmenu opent met de foto. Bij meerdere bonnen gaat er één pdf mee. Kies Mail, vul het adres in en plak de tekst.
5. Bevestig dat de mail verstuurd is. De bon gaat dan naar **Verstuurd**.

Je naam, het adres van de administratie, je IBAN, de agenda en de mailtekst stel je in via het tandwiel.
