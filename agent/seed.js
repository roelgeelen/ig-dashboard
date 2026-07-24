// Zet een export-zip die je al op je schijf hebt staan meteen in het dashboard,
// zonder de browser-automatisering. Handig om te beginnen met een basismeting
// en om de rest van de keten (lezen -> vergelijken -> versleutelen -> GitHub)
// te controleren voordat je je met Meta's UI bezighoudt.
//
//   node seed.js "..\..\exports\instagram-....zip"
//   node seed.js "...zip" --date 2026-07-24
//   node seed.js "...zip" --dry-run

const fs = require('fs');
const path = require('path');
const env = require('./lib/env');
const store = require('./lib/store');
const github = require('./lib/github');
const state = require('./lib/state');
const { parseExportZip } = require('./lib/parse');
const { encrypt, decrypt } = require('../scripts/crypto-utils');

const NAMES_PATH = 'data/names.enc.json';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  const zipPath = process.argv[2];
  if (!zipPath || zipPath.startsWith('--')) {
    console.error('Gebruik: node seed.js <pad-naar-export.zip> [--date JJJJ-MM-DD] [--dry-run]');
    process.exit(1);
  }
  const resolved = path.resolve(zipPath);
  if (!fs.existsSync(resolved)) {
    console.error('Bestand niet gevonden: ' + resolved);
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const date = arg('date') || new Date().toISOString().slice(0, 10);

  // Met --dry-run mag .env nog ontbreken: dan is dit puur een controle of je
  // export leesbaar is, zonder iets te versturen.
  let cfg = null;
  try {
    cfg = env.load();
  } catch (err) {
    if (!dryRun) throw err;
    console.log('Let op: ' + err.message);
    console.log('Ga door zonder GitHub - alleen de zip wordt gecontroleerd.\n');
  }

  console.log('Zip lezen: ' + resolved);
  const snapshot = parseExportZip(fs.readFileSync(resolved), date);
  console.log(`Gevonden: ${snapshot.followers.length} volgers, ${snapshot.following.length} volgend, ` +
    `${snapshot.pending.length} wachtende verzoeken, ${snapshot.recentlyUnfollowed.length} recent ontvolgd.`);

  if (!cfg) {
    console.log('\n--dry-run zonder .env: de export is leesbaar, er is niets verstuurd.');
    return;
  }

  const file = await github.getFile(cfg.githubToken, NAMES_PATH);
  const current = file ? store.normalize(decrypt(cfg.passphrase, JSON.parse(file.text).data)) : store.emptyStore();
  if (file) {
    console.log('Bestaande naamlijst gevonden, laatste meting: ' + (store.lastMeasurementDate(current) || 'geen'));
  } else {
    console.log('Nog geen naamlijst op GitHub - dit wordt de basismeting.');
  }

  const { store: next, changes } = store.applySnapshot(current, snapshot);

  if (changes.isFirst) {
    console.log('Basismeting: nog niets om mee te vergelijken. Vanaf de volgende meting zie je wie erbij komt en wie weggaat.');
  } else {
    console.log(`Nieuwe volgers: ${changes.newFollowers.length}, ontvolgd door: ${changes.lostFollowers.length}, ` +
      `jij ging volgen: ${changes.newFollowing.length}, jij ontvolgde: ${changes.unfollowedByYou.length}.`);
  }

  if (dryRun) {
    console.log('\n--dry-run: er is niets naar GitHub geschreven.');
    return;
  }

  const text = JSON.stringify({ v: 1, data: encrypt(cfg.passphrase, next) }, null, 2) + '\n';
  await github.putFile(cfg.githubToken, NAMES_PATH, text, `Naamlijst ingelezen uit bestaande export (${date})`);
  console.log(`\nOpgeslagen op GitHub (${Math.round(text.length / 1024)} KB). Ververs het dashboard op je telefoon.`);

  // Zodat de agent weet dat er al een meting is en niet meteen een nieuwe
  // export aanvraagt die pas over vier dagen mag.
  const s = state.load();
  s.lastSuccessDate = date;
  state.save(s);
}

main().catch((err) => {
  console.error('Mislukt: ' + err.message);
  process.exit(1);
});
