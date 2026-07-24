// Bedient het Meta Accounts Center: export aanvragen, status checken, ophalen.
//
// Dit is het enige deel dat afhangt van Meta's UI. Alle labels staan in
// selectors.json en elke stap maakt bij een fout een screenshot in agent/debug/,
// zodat je precies ziet waar het misging en welk label je moet aanvullen.

const fs = require('fs');
const path = require('path');
const { screenshot, SessionExpiredError, DOWNLOAD_DIR } = require('./session');
const log = require('./log');

const selectors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'selectors.json'), 'utf8'));

const STEP_TIMEOUT = 20000;

// Probeert de labelvarianten op volgorde: eerst als knop/link met die naam,
// daarna als losse tekst. Geeft de eerste die zichtbaar wordt.
async function findByLabels(page, labels, { timeout = STEP_TIMEOUT } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const label of labels) {
      for (const locator of [
        page.getByRole('button', { name: label, exact: false }),
        page.getByRole('link', { name: label, exact: false }),
        page.getByRole('checkbox', { name: label, exact: false }),
        page.getByRole('radio', { name: label, exact: false }),
        page.getByText(label, { exact: false }),
      ]) {
        const first = locator.first();
        if (await first.isVisible().catch(() => false)) return first;
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function clickStep(page, stepName, { optional = false } = {}) {
  const labels = selectors.steps[stepName];
  if (!labels) throw new Error(`Onbekende stap in selectors.json: ${stepName}`);

  const target = await findByLabels(page, labels);
  if (!target) {
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

  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.click({ timeout: STEP_TIMEOUT });
  await page.waitForTimeout(1500);
  log.info(`Stap "${stepName}" uitgevoerd.`);
  return true;
}

async function assertLoggedIn(page) {
  if (/\/(login|accounts\/login)/i.test(page.url())) {
    throw new SessionExpiredError();
  }
  for (const marker of selectors.loggedOutMarkers) {
    const el = page.getByText(marker, { exact: false }).first();
    if (await el.isVisible().catch(() => false)) {
      await screenshot(page, 'session-expired');
      throw new SessionExpiredError();
    }
  }
}

async function gotoDyi(page) {
  await page.goto(selectors.dyiUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await assertLoggedIn(page);
}

// Vraagt een nieuwe export aan van alleen volgers en gevolgde accounts, in JSON.
// Door alleen dat onderdeel te kiezen blijft de zip kilobytes groot en is hij
// meestal binnen enkele minuten klaar in plaats van uren.
async function requestExport(page) {
  await gotoDyi(page);

  await clickStep(page, 'downloadOrTransfer');
  await clickStep(page, 'someOfYourInformation', { optional: true });
  await clickStep(page, 'followersAndFollowing');
  await clickStep(page, 'next');
  await clickStep(page, 'downloadToDevice', { optional: true });
  await clickStep(page, 'next', { optional: true });

  // Datumbereik en notatie zitten achter een instellingenpaneel dat Meta
  // regelmatig verplaatst. Lukt het niet, dan is de standaard (alle data, HTML)
  // ook bruikbaar - de parser leest beide formaten.
  if (await clickStep(page, 'dateRange', { optional: true })) {
    await clickStep(page, 'allTime', { optional: true });
    await clickStep(page, 'save', { optional: true });
  }
  if (await clickStep(page, 'format', { optional: true })) {
    await clickStep(page, 'json', { optional: true });
    await clickStep(page, 'save', { optional: true });
  }

  await clickStep(page, 'createFiles');
  await page.waitForTimeout(3000);
  await screenshot(page, 'export-requested');
  log.info('Export aangevraagd bij Instagram.');
}

// Kijkt of er een export klaarstaat. Zo ja: downloadt hem en geeft de bytes
// terug. Zo nee: null, en probeert de agent het bij de volgende dagelijkse run
// gewoon opnieuw. Er wordt nooit gewacht in een lus.
async function tryDownloadReady(page) {
  await gotoDyi(page);

  const button = await findByLabels(page, selectors.steps.downloadReady, { timeout: 8000 });
  if (!button) {
    log.info('Nog geen export klaar om te downloaden.');
    return null;
  }

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    button.click(),
  ]);

  const target = path.join(DOWNLOAD_DIR, download.suggestedFilename() || 'export.zip');
  await download.saveAs(target);
  const buffer = fs.readFileSync(target);
  log.info(`Export gedownload: ${target} (${Math.round(buffer.length / 1024)} KB)`);

  // Zip is uitgelezen zodra de agent hem geparsed heeft; hem laten staan zou de
  // schijf volzetten met volgerslijsten in platte tekst.
  return { buffer, file: target };
}

function cleanupDownload(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // Al weg of in gebruik - niet belangrijk genoeg om de run op te laten klappen.
  }
}

module.exports = { requestExport, tryDownloadReady, gotoDyi, assertLoggedIn, cleanupDownload };
