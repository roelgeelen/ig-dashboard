# Agent — automatische naamlijsten

Vraagt elke 4 dagen zelf de officiële Instagram data-export aan, haalt hem op, vergelijkt hem met de vorige en pusht het resultaat versleuteld naar GitHub. Daarna staat in het dashboard wie je is gaan volgen en wie je heeft ontvolgd, zonder dat je iets hebt gedaan.

## Waarom zo

De Instagram Graph API geeft alleen `followers_count` — er bestaat geen endpoint voor de namen van je volgers, en er zijn ook geen webhooks voor volgers. De enige legitieme bron voor die namen is Instagram's eigen "Download je informatie". Die agent bedient dus die knop, in plaats van de private API te scrapen zoals de meeste tools doen.

Instagram staat maximaal **één export per vier dagen** toe. Sneller dan dat kan niet, langs geen enkele legitieme weg. De dagelijkse GitHub Action blijft ondertussen wel elke dag het volgersaantal ophalen, dus je ziet dagelijks *dat* er iets veranderde en om de vier dagen *wie*.

## Meerdere accounts

De accounts die het dashboard volgt staan in `data/accounts.json` (platte tekst — het zijn je eigen publieke gebruikersnamen). Elk account heeft een eigen submap `data/<slug>/` met dezelfde vier versleutelde bestanden. De agent leest dit manifest van GitHub en werkt alle accounts bij; per run vraagt hij hoogstens één nieuwe export aan (de gedeelde exportlimiet), dus over opeenvolgende dagen komen de accounts om beurten aan bod.

Een account toevoegen:

1. **Naamlijsten** werken meteen — de agent kiest het juiste profiel in de export-wizard. Heb je al een export-zip, lees hem dan in met het juiste account:
   ```bash
   node seed.js "<pad-naar-export.zip>" --account launchlygo.app
   ```
2. **Dagelijkse aantallen** hebben een eigen Instagram Graph API-token nodig (alleen mogelijk bij een Business/Creator-account). Zet het één keer klaar en push het:
   ```bash
   ENCRYPTION_PASSPHRASE=<jouw-passphrase> node ../scripts/set-token.js launchlygo.app <access_token>
   ```
   Vanaf dan ververst de dagelijkse Action het token zelf en haalt hij de aantallen op, net als bij het eerste account.

## Bereik, weergaven en postprestaties (insights)

Naast volgers en berichten kan het dashboard ook je **bereik**, **profielweergaven**, **interacties** en je **best presterende berichten** tonen. Die komen uit de insights-endpoints van de Instagram Graph API en vragen een extra recht op je token:

- `instagram_business_basic` — volgers, volgend, berichten (heb je al)
- `instagram_business_manage_insights` — bereik, weergaven, interacties en per-bericht-statistieken

Maak je long-lived token opnieuw aan met **beide** scopes en zet het klaar met `scripts/set-token.js` (zelfde commando als hierboven). De dagelijkse run haalt de insights daarna vanzelf op en schrijft ze naar `data/<slug>/insights.enc.json` en `data/<slug>/posts.enc.json`. Zolang het recht ontbreekt blijft die dashboardsectie netjes leeg — de rest blijft gewoon werken. Insights ophalen faalt nooit de dagelijkse volgersmeting: lukt het niet, dan wordt het stilzwijgend overgeslagen.

## Eenmalig installeren

```bash
cd agent
npm install
npx playwright install chromium
```

Dan de instellingen:

```bash
cp .env.example .env
```

Vul in `.env` in:

- `ENCRYPTION_PASSPHRASE` — dezelfde passphrase waarmee je het dashboard ontgrendelt
- `GITHUB_TOKEN` — fine-grained PAT met **Contents: read and write** op `roelgeelen/ig-dashboard`

Daarna één keer inloggen. Er opent een echt browservenster; jij typt je wachtwoord, de agent raakt het nooit aan:

```bash
npm run login
```

## Beginnen met een export die je al hebt

Heb je al een export-zip op je schijf staan, zet die er dan meteen in — dan hoef je niet vier dagen op de eerste meting te wachten:

```bash
node seed.js "..\..\exports\instagram-....zip"
```

Zonder `--dry-run` gaat hij versleuteld naar GitHub en staat hij direct op je telefoon. Met `--dry-run` controleert hij alleen of de zip leesbaar is; dat werkt ook zonder `.env`.

Dit is meteen de beste manier om de rest van de keten te controleren — lezen, vergelijken, versleutelen, opslaan — voordat je je met Meta's UI bezighoudt.

## Testen

Test of de browser-automatisering werkt, met een zichtbaar venster zodat je meekijkt:

```bash
node run.js --headful --force
```

Werkt dat, plan hem dan in:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-task.ps1
```

## Hoe hij draait

Elke dag om 08:00, maar hij doet per keer maximaal één ding en is daarna klaar:

| Fase | Situatie | Actie |
|---|---|---|
| `IDLE` | laatste meting ≥ 4 dagen oud | export aanvragen → `PENDING` |
| `IDLE` | recenter dan dat | niets, klaar in twee seconden |
| `PENDING` | export staat klaar | downloaden, verwerken, pushen → `IDLE` |
| `PENDING` | nog niet klaar | niets, morgen weer kijken |

Er wordt nooit gewacht in een lus. Stond je PC om 08:00 uit, dan haalt de taak de gemiste run in zodra je hem weer aanzet.

## Handige commando's

```bash
npm run status
```

Laat zien in welke fase de agent staat, wanneer hij voor het laatst draaide en hoe groot het opgeslagen bestand is.

```bash
npm test
```

Draait de tests van het opslagformaat en de export-parser.

Het log staat in `agent/agent.log`.

## Als er iets misgaat

**"Kon stap X niet vinden"** — Meta heeft de knoppen in het Accounts Center hernoemd of verplaatst. In `agent/debug/` staat een screenshot van precies dat moment. Zoek daarop het nieuwe label en voeg het toe aan de lijst voor die stap in `selectors.json`. Code aanpassen hoeft niet.

**"Sessie verlopen"** — draai `npm run login` opnieuw. Gebeurt ongeveer eens per kwartaal. Het dashboard laat dit ook zien met een rode balk, dus je komt er niet weken later achter.

**Agent draait niet meer** — het dashboard toont een gele balk zodra er drie dagen geen run is geweest.

## Wat waar staat

| Bestand | |
|---|---|
| `run.js` | de statemachine hierboven |
| `login.js` | eenmalige zichtbare login |
| `seed.js` | een bestaande export-zip inlezen, zonder browser (`--account` voor welk profiel) |
| `status.js` | leest alleen, wijzigt niets (per account) |
| `lib/accounts.js` | leest `data/accounts.json`: welke accounts moeten bijgewerkt worden |
| `lib/export.js` | het enige deel dat van Meta's UI afhangt |
| `lib/parse.js` | export-zip → dashboardformaat (JSON, met HTML als vangnet) |
| `lib/store.js` | het v2-opslagformaat |
| `selectors.json` | alle tekstlabels, apart van de code |

`.env`, `state.json`, `.session/`, `downloads/` en `debug/` staan in `.gitignore` en verlaten je PC nooit.

## Wat de agent niet doet

Geen private API's, geen scraping, geen likes of volgacties. Hij klikt op de exportknop die Instagram zelf aanbiedt, hooguit eens per vier dagen, vanaf je eigen verbinding. Dat blijft geautomatiseerde bediening van hun website — technisch grijs gebied — maar het risicoprofiel is niet te vergelijken met tools die de interne API aanroepen.
