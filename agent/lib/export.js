// Bedient het Meta Accountcentrum: export aanvragen, status checken, ophalen.
//
// De flow is vastgesteld door hem op 2026-07-24 daadwerkelijk door te lopen:
//
//   Beschikbare downloads -> Export maken -> Profielen -> <jouw account>
//   -> Kiezen waarnaar je wilt exporteren -> Exporteren naar apparaat
//   -> Je export bevestigen -> [instellingen bijstellen] -> Export starten
//
// Dit is het enige deel dat van Meta's UI afhangt. Alle labels staan in
// selectors.json en elke mislukte stap laat een screenshot achter in
// agent/debug/, zodat je ziet waar het misging.

const fs = require('fs');
const path = require('path');
const { screenshot, SessionExpiredError, DOWNLOAD_DIR } = require('./session');
const log = require('./log');

const selectors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'selectors.json'), 'utf8'));

const SETTLE_MS = 3000;

function labelsFor(stepName) {
  const labels = selectors.steps[stepName];
  if (!labels) throw new Error(`Onbekende stap in selectors.json: ${stepName}`);
  return labels;
}

// Klikt alleen echte klikbare elementen, en het kleinste dat past. Zoeken op
// losse tekst pakt op deze pagina de uitleg-alinea in plaats van de knop.
async function clickLabels(page, labels) {
  const handle = await page.evaluateHandle((wanted) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const cands = [
      ...document.querySelectorAll('[role=button],button,a,[role=link],[role=radio],[role=checkbox],[role=menuitem],[role=tab],label'),
    ].filter(vis);
    const shortest = (list) => list.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length)[0];

    for (const label of wanted) {
      const t = norm(label);
      const exact = cands.filter((el) => norm(el.innerText) === t);
      if (exact.length) return shortest(exact);
    }
    for (const label of wanted) {
      const t = norm(label);
      const partial = cands.filter((el) => norm(el.innerText).includes(t));
      if (partial.length) return shortest(partial);
    }
    return null;
  }, labels);

  const el = handle.asElement();
  if (!el) return false;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ timeout: 15000 }).catch(async () => {
    await el.evaluate((n) => n.click());
  });
  await page.waitForTimeout(SETTLE_MS);
  return true;
}

async function clickStep(page, stepName, { optional = false } = {}) {
  const labels = labelsFor(stepName);
  const ok = await clickLabels(page, labels);
  if (ok) {
    log.info(`Stap "${stepName}" uitgevoerd.`);
    return true;
  }
  if (optional) {
    log.info(`Stap "${stepName}" niet gevonden, overgeslagen (optioneel).`);
    return false;
  }
  const shot = await screenshot(page, `fail-${stepName}`);
  throw new Error(
    `Kon stap "${stepName}" niet vinden. Gezocht op: ${labels.join(' | ')}. ` +
      (shot ? `Screenshot: ${shot}` : 'Screenshot maken lukte niet.')
  );
}

// De laatste zichtbare kop verraadt op welk wizardscherm we staan.
async function currentHeading(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const hs = [...document.querySelectorAll('h1,h2,h3,[role=heading]')].filter(vis).map((e) => e.innerText.trim());
    return hs[hs.length - 1] || '';
  });
}

function headingMatches(heading, key) {
  const want = selectors.headings[key] || [];
  const h = (heading || '').toLowerCase();
  return want.some((w) => h.includes(w.toLowerCase()));
}

async function assertLoggedIn(page) {
  if (/\/(login|accounts\/login)/i.test(page.url())) throw new SessionExpiredError();
  if ((await page.locator('input[type=password]').count()) > 0) {
    await screenshot(page, 'session-expired');
    throw new SessionExpiredError();
  }
}

// De wizard onthoudt waar je gebleven was, dus altijd opnieuw laden voordat we
// beginnen. Anders klikt de agent verder in een half afgemaakte vorige poging.
async function gotoDyi(page) {
  await page.goto(selectors.dyiUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  await assertLoggedIn(page);
  return currentHeading(page);
}

// Zet de categorie-vinkjes op precies een gewenste stand.
//
// Het categoriescherm heeft 38 vakjes die standaard allemaal aan staan. Blind
// op "Volgers en volgend" klikken zet dat vinkje dus juist UIT. En "Alles
// wissen" bleek de selectie niet blijvend te legen. Daarom per vakje de stand
// vergelijken en alleen klikken waar die niet klopt - dat is meteen idempotent.
async function setDataSelection(page, keepLabels) {
  const result = await page.evaluate((wanted) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const boxes = [...document.querySelectorAll('input[type=checkbox],[role=checkbox]')].filter(vis);

    const labelOf = (box) => {
      let label = norm(box.getAttribute('aria-label') || '');
      let el = box;
      for (let i = 0; i < 6 && el && !label; i++) {
        el = el.parentElement;
        if (el) {
          const t = norm(el.innerText);
          if (t && t.length < 70) label = t;
        }
      }
      return label;
    };

    const isChecked = (box) =>
      box.tagName === 'INPUT' ? box.checked : box.getAttribute('aria-checked') === 'true';

    const want = wanted.map((w) => w.toLowerCase());
    const changed = [];
    const kept = [];

    for (const box of boxes) {
      const label = labelOf(box);
      const shouldKeep = want.some((w) => label.toLowerCase().includes(w));
      if (shouldKeep) kept.push(label);
      if (isChecked(box) !== shouldKeep) {
        box.click();
        changed.push((shouldKeep ? '+' : '-') + label);
      }
    }
    return { total: boxes.length, kept, changed: changed.length };
  }, keepLabels);

  return result;
}

// Beperkt de export tot volgers en gevolgde accounts. Zonder dit levert Meta
// alles op: bij dit account was dat 195 MB met alle media, en dat duurt uren in
// plaats van minuten. Mislukt het bijstellen, dan gaat de export gewoon door -
// de parser leest zowel JSON als HTML, dus het resultaat klopt hoe dan ook.
async function narrowScope(page) {
  if (await clickStep(page, 'adjustData', { optional: true })) {
    const sel = await setDataSelection(page, labelsFor('followersAndFollowing'));
    if (!sel.kept.length) {
      const shot = await screenshot(page, 'fail-followersAndFollowing');
      log.warn(
        `Kon "Volgers en volgend" niet aanvinken tussen ${sel.total} categorieen; ` +
          `export wordt groter dan nodig. Screenshot: ${shot}`
      );
    } else {
      log.info(`Categorieen: ${sel.total} gevonden, behouden: ${sel.kept.join(', ')} (${sel.changed} vakjes omgezet).`);
    }
    await page.waitForTimeout(1000);
    await clickStep(page, 'save', { optional: true });
  }

  if (await clickStep(page, 'dateRange', { optional: true })) {
    await clickStep(page, 'allTime', { optional: true });
    await clickStep(page, 'save', { optional: true });
  }

  if (await clickStep(page, 'format', { optional: true })) {
    await clickStep(page, 'json', { optional: true });
    await clickStep(page, 'save', { optional: true });
  }
}

async function requestExport(page, { username, dryRun = false } = {}) {
  const heading = await gotoDyi(page);
  log.info(`Startscherm: "${heading}"`);

  await clickStep(page, 'createExport');

  // Meerdere gekoppelde accounts: expliciet het juiste profiel kiezen.
  const afterCreate = await currentHeading(page);
  if (headingMatches(afterCreate, 'profiles')) {
    if (!username) throw new Error('Er wordt om een profiel gevraagd maar IG_USERNAME is niet ingesteld in agent/.env.');
    if (!(await clickLabels(page, [username]))) {
      const shot = await screenshot(page, 'fail-profile');
      throw new Error(`Profiel "${username}" niet gevonden op het profielscherm. Screenshot: ${shot}`);
    }
    log.info(`Profiel "${username}" gekozen.`);
  }

  await clickStep(page, 'exportToDevice');

  const confirm = await currentHeading(page);
  if (!headingMatches(confirm, 'confirm')) {
    log.warn(`Onverwacht scherm voor bevestiging: "${confirm}"`);
  }

  await narrowScope(page);

  if (dryRun) {
    const shot = await screenshot(page, 'dryrun-confirm');
    log.info(`--dry-run: gestopt vlak voor "Export starten". Screenshot: ${shot}`);
    return false;
  }

  await clickStep(page, 'startExport');
  await page.waitForTimeout(SETTLE_MS);
  await screenshot(page, 'export-requested');
  log.info('Export aangevraagd bij Instagram.');
  return true;
}

// Kijkt of er een export klaarstaat. Zo ja: downloadt hem. Zo nee: null, en
// probeert de agent het bij de volgende dagelijkse run opnieuw. Er wordt nooit
// gewacht in een lus.
async function tryDownloadReady(page) {
  await gotoDyi(page);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }).catch(() => null),
    clickLabels(page, labelsFor('downloadReady')),
  ]);

  if (!download) {
    log.info('Nog geen export klaar om te downloaden.');
    return null;
  }

  const target = path.join(DOWNLOAD_DIR, download.suggestedFilename() || 'export.zip');
  await download.saveAs(target);
  const buffer = fs.readFileSync(target);
  log.info(`Export gedownload: ${target} (${Math.round(buffer.length / 1024)} KB)`);
  return { buffer, file: target };
}

// De zip bevat je volgerslijst in platte tekst; die laten slingeren op schijf
// is onnodig.
function cleanupDownload(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // Al weg of in gebruik.
  }
}

module.exports = { requestExport, tryDownloadReady, gotoDyi, assertLoggedIn, cleanupDownload, currentHeading };
