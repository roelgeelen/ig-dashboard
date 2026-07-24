// Dagelijkse run. Doet per keer maximaal een ding en is daarna klaar:
//
//   IDLE    + laatste meting >= interval oud  -> export aanvragen -> PENDING
//   PENDING + export staat klaar              -> ophalen, verwerken -> IDLE
//   PENDING + nog niet klaar                  -> niets, morgen weer
//
// Er wordt nooit gewacht in een lus, dus een run duurt seconden en er blijft
// niets op de achtergrond hangen.

const env = require('./lib/env');
const log = require('./lib/log');
const state = require('./lib/state');
const store = require('./lib/store');
const github = require('./lib/github');
const { parseExportZip } = require('./lib/parse');
const { encrypt, decrypt } = require('../scripts/crypto-utils');
const { openContext, SessionExpiredError } = require('./lib/session');
const { requestExport, tryDownloadReady, cleanupDownload } = require('./lib/export');

const NAMES_PATH = 'data/names.enc.json';
const STATUS_PATH = 'data/agent-status.enc.json';
const PENDING_GIVE_UP_DAYS = 14;

const headful = process.argv.includes('--headful');
const force = process.argv.includes('--force');

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function loadStore(cfg) {
  const file = await github.getFile(cfg.githubToken, NAMES_PATH);
  if (!file) {
    log.info('Nog geen names.enc.json op GitHub - dit wordt de eerste meting.');
    return store.emptyStore();
  }
  const blob = JSON.parse(file.text);
  return store.normalize(decrypt(cfg.passphrase, blob.data));
}

async function saveStore(cfg, next, message) {
  const text = JSON.stringify({ v: 1, data: encrypt(cfg.passphrase, next) }, null, 2) + '\n';
  await github.putFile(cfg.githubToken, NAMES_PATH, text, message);
}

// Het dashboard laat hiermee zien of de agent nog gezond is. Versleuteld, omdat
// een foutmelding paden van je PC kan bevatten.
async function saveStatus(cfg, s) {
  const payload = {
    phase: s.phase,
    requestedAt: s.requestedAt,
    lastSuccessDate: s.lastSuccessDate,
    lastRunAt: s.lastRunAt,
    lastError: s.lastError,
    sessionValid: s.sessionValid,
    consecutiveFailures: s.consecutiveFailures,
  };
  const text = JSON.stringify({ v: 1, data: encrypt(cfg.passphrase, payload) }, null, 2) + '\n';
  await github.putFile(cfg.githubToken, STATUS_PATH, text, 'Agent-status bijgewerkt');
}

async function processDownload(cfg, s, buffer) {
  const snapshot = parseExportZip(buffer, today());
  log.info(`Export gelezen: ${snapshot.followers.length} volgers, ${snapshot.following.length} volgend.`);

  const current = await loadStore(cfg);
  const { store: next, changes } = store.applySnapshot(current, snapshot);

  if (changes.isFirst) {
    log.info('Eerste meting - nog niets om mee te vergelijken.');
  } else {
    log.info(
      `Nieuwe volgers: ${changes.newFollowers.length}, ontvolgd door: ${changes.lostFollowers.length}, ` +
        `jij ging volgen: ${changes.newFollowing.length}, jij ontvolgde: ${changes.unfollowedByYou.length}.`
    );
    if (changes.newFollowers.length) log.info('  + ' + changes.newFollowers.join(', '));
    if (changes.lostFollowers.length) log.info('  - ' + changes.lostFollowers.join(', '));
  }

  await saveStore(cfg, next, `Naamlijst automatisch bijgewerkt (${snapshot.date})`);
  log.info('Naamlijst opgeslagen op GitHub.');

  s.phase = state.IDLE;
  s.requestedAt = null;
  s.lastSuccessDate = snapshot.date;
  s.lastError = null;
  s.consecutiveFailures = 0;
}

async function main() {
  const cfg = env.load();
  const s = state.load();
  s.lastRunAt = new Date().toISOString();

  const current = await loadStore(cfg);
  const age = store.daysSinceLastMeasurement(current, today());
  log.info(`Fase: ${s.phase}. Laatste meting: ${store.lastMeasurementDate(current) || 'geen'} (${age === Infinity ? 'nooit' : age + ' dagen geleden'}).`);

  // Een aanvraag die na twee weken nog niet is opgehaald, is vrijwel zeker
  // verlopen - Instagram bewaart een download maar vier dagen.
  if (s.phase === state.PENDING && s.requestedAt) {
    const pendingDays = (Date.now() - Date.parse(s.requestedAt)) / 86400000;
    if (pendingDays > PENDING_GIVE_UP_DAYS) {
      log.warn(`Aanvraag staat al ${Math.round(pendingDays)} dagen open en is waarschijnlijk verlopen. Terug naar IDLE.`);
      s.phase = state.IDLE;
      s.requestedAt = null;
    }
  }

  const needsExport = s.phase === state.IDLE && (force || age >= cfg.intervalDays);
  if (s.phase === state.IDLE && !needsExport) {
    log.info(`Nog geen nieuwe export nodig (interval is ${cfg.intervalDays} dagen). Klaar.`);
    s.sessionValid = true;
    state.save(s);
    await saveStatus(cfg, s);
    return;
  }

  const context = await openContext({ headless: !headful });
  const page = context.pages()[0] || (await context.newPage());

  try {
    if (s.phase === state.PENDING) {
      const result = await tryDownloadReady(page);
      if (result) {
        await processDownload(cfg, s, result.buffer);
        cleanupDownload(result.file);
      } else {
        log.info('Export nog in behandeling bij Instagram. Volgende run kijkt opnieuw.');
      }
    } else {
      await requestExport(page);
      s.phase = state.PENDING;
      s.requestedAt = new Date().toISOString();
      s.lastError = null;
      s.consecutiveFailures = 0;
    }
    s.sessionValid = true;
  } catch (err) {
    s.lastError = err.message;
    s.consecutiveFailures = (s.consecutiveFailures || 0) + 1;
    if (err instanceof SessionExpiredError) {
      s.sessionValid = false;
      log.error('Sessie verlopen. Draai "npm run login" om opnieuw in te loggen.');
    } else {
      log.error('Run mislukt: ' + err.message);
    }
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    state.save(s);
    await saveStatus(cfg, s).catch((e) => log.warn('Status wegschrijven mislukt: ' + e.message));
  }
}

main().catch((err) => {
  log.error('Onverwachte fout: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
