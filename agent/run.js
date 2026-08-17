// Dagelijkse run. Werkt elk gevolgd account bij en doet per keer weinig:
//
//   Fase 1: voor elk account dat op een export wacht (PENDING) -> kijken of hij
//           klaarstaat, en zo ja downloaden en verwerken -> IDLE.
//   Fase 2: hoogstens EEN nieuwe export aanvragen, voor het IDLE-account dat het
//           langst geleden gemeten is. Instagram staat maar mondjesmaat exports
//           toe, dus we belasten die limiet met niet meer dan één aanvraag per
//           run. Een account dat nog op zijn export wacht (PENDING) telt niet
//           mee als kandidaat, maar blokkeert de andere accounts niet - de
//           exportlimiet geldt per profiel. Over opeenvolgende dagen komen zo
//           alle accounts om beurten aan bod.
//
// Er wordt nooit gewacht in een lus, dus een run duurt seconden.

const env = require('./lib/env');
const log = require('./lib/log');
const state = require('./lib/state');
const store = require('./lib/store');
const github = require('./lib/github');
const { loadAccounts } = require('./lib/accounts');
const { parseExportZip } = require('./lib/parse');
const { encrypt, decrypt } = require('../scripts/crypto-utils');
const { openContext, SessionExpiredError } = require('./lib/session');
const { requestExport, tryDownloadReady, cleanupDownload } = require('./lib/export');

const namesPath = (slug) => `data/${slug}/names.enc.json`;
const statusPath = (slug) => `data/${slug}/agent-status.enc.json`;
const PENDING_GIVE_UP_DAYS = 14;

const headful = process.argv.includes('--headful');
const force = process.argv.includes('--force');
// Loopt de wizard helemaal door maar stopt vlak voor "Export starten", zodat je
// de knoppen kunt controleren zonder je exportlimiet op te maken.
const dryRun = process.argv.includes('--dry-run');

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function loadStore(cfg, slug) {
  const file = await github.getFile(cfg.githubToken, namesPath(slug));
  if (!file) {
    log.info(`[${slug}] Nog geen naamlijst op GitHub - dit wordt de eerste meting.`);
    return store.emptyStore();
  }
  const blob = JSON.parse(file.text);
  return store.normalize(decrypt(cfg.passphrase, blob.data));
}

async function saveStore(cfg, slug, next, message) {
  const text = JSON.stringify({ v: 1, data: encrypt(cfg.passphrase, next) }, null, 2) + '\n';
  await github.putFile(cfg.githubToken, namesPath(slug), text, message);
}

// Het dashboard laat hiermee zien of de agent nog gezond is. Versleuteld, omdat
// een foutmelding paden van je PC kan bevatten.
async function saveStatus(cfg, slug, sub, lastRunAt) {
  const payload = {
    phase: sub.phase,
    requestedAt: sub.requestedAt,
    lastSuccessDate: sub.lastSuccessDate,
    lastRunAt,
    lastError: sub.lastError,
    sessionValid: sub.sessionValid,
    consecutiveFailures: sub.consecutiveFailures,
  };
  const text = JSON.stringify({ v: 1, data: encrypt(cfg.passphrase, payload) }, null, 2) + '\n';
  await github.putFile(cfg.githubToken, statusPath(slug), text, `Agent-status bijgewerkt (${slug})`);
}

async function processDownload(cfg, slug, sub, buffer) {
  const snapshot = parseExportZip(buffer, today());
  log.info(`[${slug}] Export gelezen: ${snapshot.followers.length} volgers, ${snapshot.following.length} volgend.`);

  const current = await loadStore(cfg, slug);
  const { store: next, changes } = store.applySnapshot(current, snapshot);

  if (changes.isFirst) {
    log.info(`[${slug}] Eerste meting - nog niets om mee te vergelijken.`);
  } else {
    log.info(
      `[${slug}] Nieuwe volgers: ${changes.newFollowers.length}, ontvolgd door: ${changes.lostFollowers.length}, ` +
        `jij ging volgen: ${changes.newFollowing.length}, jij ontvolgde: ${changes.unfollowedByYou.length}.`
    );
    if (changes.newFollowers.length) log.info('  + ' + changes.newFollowers.join(', '));
    if (changes.lostFollowers.length) log.info('  - ' + changes.lostFollowers.join(', '));
  }

  await saveStore(cfg, slug, next, `Naamlijst automatisch bijgewerkt (${slug}, ${snapshot.date})`);
  log.info(`[${slug}] Naamlijst opgeslagen op GitHub.`);

  sub.phase = state.IDLE;
  sub.requestedAt = null;
  sub.lastSuccessDate = snapshot.date;
  sub.lastError = null;
  sub.consecutiveFailures = 0;
}

// Kijkt of de openstaande export voor dit account klaarstaat en verwerkt hem.
async function handlePending(cfg, page, acc, sub) {
  // Een aanvraag die na twee weken nog niet is opgehaald, is vrijwel zeker
  // verlopen - Instagram bewaart een download maar een paar dagen.
  if (sub.requestedAt) {
    const pendingDays = (Date.now() - Date.parse(sub.requestedAt)) / 86400000;
    if (pendingDays > PENDING_GIVE_UP_DAYS) {
      log.warn(`[${acc.slug}] Aanvraag staat al ${Math.round(pendingDays)} dagen open en is waarschijnlijk verlopen. Terug naar IDLE.`);
      sub.phase = state.IDLE;
      sub.requestedAt = null;
      return;
    }
  }

  const result = await tryDownloadReady(page, { username: acc.username, slug: acc.slug });
  if (result) {
    await processDownload(cfg, acc.slug, sub, result.buffer);
    cleanupDownload(result.file);
  } else {
    log.info(`[${acc.slug}] Export nog in behandeling bij Instagram. Volgende run kijkt opnieuw.`);
  }
}

async function main() {
  const cfg = env.load();
  const { accounts, default: defaultSlug } = await loadAccounts(cfg);
  log.info(`Accounts: ${accounts.map((a) => a.username).join(', ')}.`);

  const s = state.load();
  s.lastRunAt = new Date().toISOString();
  // Zorg dat elk account een substate heeft (en migreer eventueel oude state).
  for (const acc of accounts) state.forAccount(s, acc.slug, acc.slug === defaultSlug);

  const context = await openContext({ headless: !headful });
  const page = context.pages()[0] || (await context.newPage());

  try {
    // ---- Fase 1: openstaande exports ophalen ----
    for (const acc of accounts) {
      const sub = s.accounts[acc.slug];
      if (sub.phase !== state.PENDING) continue;
      try {
        await handlePending(cfg, page, acc, sub);
        sub.sessionValid = true;
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err;
        sub.lastError = err.message;
        sub.consecutiveFailures = (sub.consecutiveFailures || 0) + 1;
        log.error(`[${acc.slug}] Ophalen mislukt: ${err.message}`);
      }
    }

    // ---- Fase 2: hoogstens één nieuwe export aanvragen ----
    // Alleen IDLE-accounts komen in aanmerking. Een account dat nog op zijn
    // export wacht valt hier vanzelf buiten, maar houdt de andere accounts niet
    // langer tegen: de exportlimiet geldt per profiel, dus één vastzittend
    // account mag een gezond account niet laten verhongeren.
    let target = null;
    for (const acc of accounts) {
      const sub = s.accounts[acc.slug];
      if (sub.phase !== state.IDLE) continue;
      const cur = await loadStore(cfg, acc.slug);
      const age = store.daysSinceLastMeasurement(cur, today());
      log.info(`[${acc.slug}] Laatste meting: ${store.lastMeasurementDate(cur) || 'geen'} (${age === Infinity ? 'nooit' : age + ' dagen geleden'}).`);
      if ((force || age >= cfg.intervalDays) && (!target || age > target.age)) {
        target = { acc, sub, age };
      }
    }

    if (!target) {
      log.info(`Geen IDLE-account is toe aan een nieuwe export (interval is ${cfg.intervalDays} dagen). Klaar.`);
    } else {
      try {
        const submitted = await requestExport(page, { username: target.acc.username, dryRun });
        if (submitted) {
          target.sub.phase = state.PENDING;
          target.sub.requestedAt = new Date().toISOString();
          target.sub.lastError = null;
          target.sub.consecutiveFailures = 0;
          log.info(`[${target.acc.slug}] Export aangevraagd.`);
        } else {
          log.info(`[${target.acc.slug}] Droogloop: er is niets aangevraagd, de fase blijft ongewijzigd.`);
        }
        target.sub.sessionValid = true;
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err;
        target.sub.lastError = err.message;
        target.sub.consecutiveFailures = (target.sub.consecutiveFailures || 0) + 1;
        log.error(`[${target.acc.slug}] Aanvragen mislukt: ${err.message}`);
      }
    }
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      // De login is voor alle accounts dezelfde, dus markeer ze allemaal.
      for (const acc of accounts) {
        const sub = s.accounts[acc.slug];
        sub.sessionValid = false;
        sub.lastError = err.message;
      }
      log.error('Sessie verlopen. Draai "npm run login" om opnieuw in te loggen.');
    } else {
      log.error('Run mislukt: ' + err.message);
    }
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    state.save(s);
    for (const acc of accounts) {
      const sub = s.accounts[acc.slug];
      if (sub) await saveStatus(cfg, acc.slug, sub, s.lastRunAt).catch((e) => log.warn(`[${acc.slug}] Status wegschrijven mislukt: ` + e.message));
    }
  }
}

main().catch((err) => {
  log.error('Onverwachte fout: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
