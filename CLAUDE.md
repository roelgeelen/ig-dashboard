# CLAUDE.md — projectgids voor Claude

Instagram-groei- en analytics-dashboard voor de accounts van de eigenaar
(`@dutch_718_gts` en `@launchlygo.app`). Statische single-page site + versleutelde
data in de repo + twee data-pijplijnen (een dagelijkse GitHub Action en een lokale
browser-agent). Alles is client-side versleuteld met één passphrase.

## Overzicht van de architectuur

Er zijn drie losse onderdelen:

1. **`index.html`** — het hele dashboard: één bestand met inline CSS + JS. Geen
   build-stap, geen framework. Externe libs via CDN: Chart.js 4.5, Grid.js 5.0,
   JSZip 3.10. Draait volledig in de browser; ontsleutelt de data met de
   passphrase die de gebruiker in het "gate"-scherm invult.
2. **`scripts/`** — de **dagelijkse pijplijn** die via de GitHub Action draait
   (`.github/workflows/fetch-instagram-data.yml`, cron `17 6 * * *` UTC). Haalt via
   de Instagram Graph API het volgersaantal, berichtenaantal en (indien het token
   de rechten heeft) insights + postprestaties op, en committeert die versleuteld.
3. **`agent/`** — een **lokale Playwright-agent** op de PC van de eigenaar die elke
   4 dagen de officiële Instagram data-export ("Download je informatie") aanvraagt,
   ophaalt, met de vorige vergelijkt en de **namenlijsten** versleuteld naar GitHub
   pusht. Nodig omdat de Graph API geen namen van volgers geeft — alleen aantallen.

De dagelijkse Action ziet je *dat* er iets veranderde; de agent ziet om de vier
dagen *wie*. Sneller dan 1×/4 dagen staat Instagram niet toe.

## Deployment / "live zetten"

- De site wordt geserveerd via **GitHub Pages vanaf `main`** (repo-root). Er is geen
  Pages-workflow of CNAME; het is de standaard Pages-config op de `main`-branch.
- **"Live zetten" = naar `main` brengen.** In dit project committeert ook de
  dagelijkse bot rechtstreeks naar `main` (geen PR-cultuur, geen branch-protectie
  waargenomen). Werk op je toegewezen feature-branch, en zet live met een
  fast-forward van `main` naar die branch, gevolgd door `git push origin main`.
- De GitHub-**integratie mag workflows niet dispatchen** (`403 Resource not
  accessible by integration`). Handmatig triggeren doet de gebruiker via de
  Actions-tab; workflow-runs en logs **lezen** mag wel (via de `mcp__github__`
  actions-tools).

## Datamodel (`data/`)

- `data/accounts.json` — **platte tekst** (alleen publieke gebruikersnamen). Lijst
  van accounts + `default`. Bepaalt de profielswitcher en welke accounts de
  pijplijnen bijwerken. Elk account heeft een submap `data/<slug>/`.
- Per account, allemaal **versleuteld** als `{ v:1, data:"<base64>" }`:
  - `token.enc.json` — `{ access_token, last_refreshed, expires_in_seconds }`.
    Long-lived Instagram-login-token; de Action ververst het dagelijks via
    `ig_refresh_token`.
  - `history.enc.json` — array `[{ date, followers_count, follows_count, media_count? }]`.
  - `insights.enc.json` — array `[{ date, reach?, profile_views?, total_interactions?, likes?, ... }]`
    (alleen de metrics die lukten). Nieuw sinds de insights-integratie.
  - `posts.enc.json` — momentopname `{ date, posts:[{ id, caption, media_type,
    media_product_type, permalink, timestamp, thumbnail_url, like_count,
    comments_count, reach?, saved?, total_interactions?, shares? }] }`.
  - `names.enc.json` — **v2-opslagformaat** (zie hieronder).
  - `agent-status.enc.json` — status van de lokale agent (voor de statusbanner).

### Namen-opslagformaat v2 (`names.enc.json`)

v1 was een array van volledige snapshots (~190 KB per meting → onhoudbaar). v2
bewaart alleen de huidige stand + een event-log:

```
{ v:2,
  current:  { date, followers:[[user,since],...], following:[[user,since],...],
              pending:[], recentRequests:[], recentlyUnfollowed:[] },
  previous: { date, followers:[user,...], following:[user,...] },  // alleen namen
  events:   [[date, user, type]],   // type: 'f+' ging volgen, 'f-' ontvolgde jou,
                                     //        'g+' jij ging volgen, 'g-' jij ontvolgde
  measurements: [date, ...] }
```

`applyNameSnapshot()` (identiek in `index.html` en `agent/lib/store.js`) berekent de
events tussen de vorige en de nieuwe stand. `normalizeNameStore()` migreert oude
v1-data automatisch. Handmatige upload (dashboard) en automatische agent gebruiken
hetzelfde formaat, dus ze kunnen door elkaar heen lopen.

## Crypto (moet exact overeenkomen tussen browser en Node)

- PBKDF2-SHA256, **100000 iteraties**, salt `"ig-dashboard-v1-salt"`, sleutel 256-bit.
- AES-256-GCM; opslag = base64 van `iv(12) || ciphertext || tag(16)`.
- Browser: `igEncrypt`/`igDecrypt` in `index.html`. Node: `scripts/crypto-utils.js`.
  **Verander de een niet zonder de ander** — anders wordt bestaande data onleesbaar.
- De passphrase staat in GitHub Actions als secret `ENCRYPTION_PASSPHRASE`. Claude
  heeft deze **niet**; versleutelde data is dus niet lokaal te ontsleutelen.

## Insights-integratie (bereik, weergaven, postprestaties)

- `scripts/insights.js` — **defensieve** Graph API-client. Elke metric en elke post
  wordt apart geprobeerd; een fout levert "geen waarde" op i.p.v. een exception.
  Reden: een token zónder `instagram_business_manage_insights` mag de dagelijkse
  volgersmeting **nooit** laten falen. `pickValue()` leest zowel het `total_value`-
  als het `values`-antwoordformaat. API-versie: `graph.instagram.com/v22.0`.
- `scripts/fetch-and-update.js` roept na het bijwerken van `history` de functies
  `updateInsights()` en `updatePosts()` aan (beide in een try/catch, falen = skippen).
- Dashboard toont de sectie **"Bereik & activiteit"** alleen als er data is; anders
  een lege staat die uitlegt dat het insights-recht ontbreekt.
- **Benodigde token-scopes:** `instagram_business_basic` (volgers/berichten) +
  `instagram_business_manage_insights` (bereik/weergaven/interacties/postprestaties).
- **Token controleren zonder Meta:**
  `ENCRYPTION_PASSPHRASE=<pass> node scripts/check-stored-token.js dutch_718_gts`
  (ontsleutelt het opgeslagen token en test de rechten). Een los token testen:
  `node scripts/check-token.js <token>`. Gedeelde logica: `checkToken()` in
  `scripts/check-token.js`.
- Nieuw token klaarzetten: `ENCRYPTION_PASSPHRASE=<pass> node scripts/set-token.js
  <username> <token>` → committeer `data/<slug>/token.enc.json`.

## Dashboard-UI (`index.html`)

- Professioneel, **merk-neutraal** palet (bewust niet de Instagram-gradient), met
  **licht/donker-thema** (toggle rechtsboven, opgeslagen in `localStorage`,
  standaard = systeemvoorkeur). Kleuren komen uit de dataviz-skill en zijn
  gevalideerd op kleurenblindheid (blauw = volgers, aqua = volgend).
- Secties: Overzicht (KPI-tegels), Inzichten (o.a. mijlpaal-projectie via lineaire
  regressie), Trends (volgers/volgend, dagelijkse nettogroei met 7-daags
  gemiddelde, groei per week, volger-cohort), Bereik & activiteit (insights),
  Relaties (namenlijsten in tabs via Grid.js), Naamlijsten bijwerken (upload).
- **Alle analytics worden client-side berekend** uit `history` + `nameStore` +
  `insightsHist`/`postsSnap`. Geen server.
- Chart-kleuren komen uit het JS-object `PALETTE` (light/dark); grafieken worden bij
  een themawissel opnieuw opgebouwd (`renderAll` + `renderNamesAll` + `renderApiInsights`).
- **Belangrijk:** de vele element-ID's die de JS gebruikt moeten blijven bestaan bij
  layout-wijzigingen (`summaryCards`, `historyChart`, `growthChart`, `weeklyChart`,
  `cohortChart`, `reachChart`, `apiKpis`, `postGrid`, `nameTabBar`, `nameTabPages`,
  gate-/gh-/dropzone-ID's, enz.).
- **Grid.js** krijgt via CSS dark-mode-overrides — bij nieuwe tabellen die stijl
  aanhouden.

## Lokaal testen (geen dev-server nodig)

De sandbox mag geen CDN's bereiken, maar wel de npm-registry, en er is een Chromium.
Recept dat in deze repo werkt om het dashboard visueel te testen met mock-data:

1. In een scratchmap: `npm install chart.js@4.5.0 gridjs@5.0.2 jszip@3.10.1`.
2. Kopieer `index.html`, vervang de vier CDN-URL's door de lokale `node_modules/…`-
   paden, en injecteer vóór `</body>` een scriptje dat op `load` de gate omzeilt:
   zet `PASSPHRASE`, `history`, `insightsHist`, `postsSnap`, `nameStore`,
   `agentStatus`, toon `#app`, en roep `renderAll(); renderNamesAll();
   renderApiInsights();` aan.
3. Screenshot met headless Chromium:
   `/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless=new --no-sandbox
   --disable-gpu --hide-scrollbars --window-size=1200,3400 --virtual-time-budget=7000
   --screenshot=out.png "file://…/test.html"`.
   Voor donker: zet `document.documentElement.setAttribute('data-theme','dark')` in de
   injectie. Emoji/glyphs renderen soms niet in headless — gebruik inline SVG voor
   iconen (zoals de thema-toggle).
- Syntaxcheck van de inline JS: knip het `<script>…</script>`-blok eruit en draai
  `node --check`.
- Pipeline-tests: `insights.js` is te unit-testen met een geïnjecteerde `fetchImpl`
  (mock). `agent/`: `npm test` draait de opslagformaat- en export-parsertests.

## Valkuilen / weten

- **Export-cutoff:** Instagram kapt de volgerslijst in de export af (bij dit account
  ~8 maanden, terwijl de volglijst 5 jaar teruggaat). Wie je vóór die grens ging
  volgen, ontbreekt en zou onterecht als "volgt niet terug" verschijnen. Het
  dashboard vangt dit op met de tab **"Niet te zeggen"** (`followersCutoff()` +
  `unverifiable`-logica in `diffAllNames()`). Niet weggooien.
- **Insights-antwoordformaat** verschilt per metric/API-versie (sommige eisen
  `metric_type=total_value`, andere weigeren het). Daarom probeert `fetchAccountMetric`
  meerdere varianten. Nooit alle metrics in één call zetten — één ongeldige metric
  laat de hele call falen.
- **Post-thumbnails** (`thumbnail_url`/`media_url`) zijn CDN-links die kunnen
  verlopen; de post-cards vallen daarom terug op een placeholder-icoon.
- De dagelijkse cron staat bewust op **minuut 17** (`:00` wordt door GitHub bij
  drukte vaak vertraagd/overgeslagen).
- De workflow rebaset bij een push-botsing (de agent kan tegelijk via de API
  committen) — niet vervangen door een simpele push.

## Scripts (`scripts/`)

| Bestand | |
|---|---|
| `fetch-and-update.js` | dagelijkse pijplijn (aantallen + insights + posts) |
| `insights.js` | defensieve Graph API-client voor insights & top-posts |
| `check-token.js` | test een **los** token op werking + insights-rechten (`checkToken()`) |
| `check-stored-token.js` | ontsleutelt en test het **opgeslagen** token |
| `set-token.js` | zet een token versleuteld klaar + registreert het account |
| `crypto-utils.js` | AES-GCM/PBKDF2 (spiegelt de browser-crypto) |
| `accounts.js` | leest `data/accounts.json`, `slugify()` |

## Werkwijze-afspraken

- UI-teksten, code-commentaar en commit-berichten zijn in het **Nederlands** — houd
  die stijl aan.
- Zet het model-ID / interne modelnaam **niet** in commits, code of PR's.
- Push naar de toegewezen feature-branch; zet pas live (`main`) als het af is en,
  bij dit project, wanneer de gebruiker dat vraagt.
