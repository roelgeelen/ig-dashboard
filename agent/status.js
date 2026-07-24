// Laat zien wat de agent aan het doen is, zonder iets te wijzigen.

const env = require('./lib/env');
const state = require('./lib/state');
const store = require('./lib/store');
const github = require('./lib/github');
const { decrypt } = require('../scripts/crypto-utils');

function fmt(v) {
  return v === null || v === undefined || v === '' ? '—' : v;
}

async function main() {
  const cfg = env.load();
  const s = state.load();

  console.log('');
  console.log('  Agent-status');
  console.log('  ------------');
  console.log('  Fase                :', s.phase);
  console.log('  Laatste run         :', fmt(s.lastRunAt));
  console.log('  Export aangevraagd  :', fmt(s.requestedAt));
  console.log('  Laatste succes      :', fmt(s.lastSuccessDate));
  console.log('  Sessie geldig       :', s.sessionValid ? 'ja' : 'NEE - draai "npm run login"');
  console.log('  Mislukte runs op rij:', s.consecutiveFailures || 0);
  console.log('  Laatste fout        :', fmt(s.lastError));

  const file = await github.getFile(cfg.githubToken, 'data/names.enc.json');
  if (!file) {
    console.log('');
    console.log('  Nog geen naamlijst op GitHub.');
    console.log('');
    return;
  }

  const data = store.normalize(decrypt(cfg.passphrase, JSON.parse(file.text).data));
  const last = store.lastMeasurementDate(data);
  console.log('');
  console.log('  Naamlijst op GitHub');
  console.log('  -------------------');
  console.log('  Laatste meting      :', fmt(last), `(${store.daysSinceLastMeasurement(data, new Date().toISOString().slice(0, 10))} dagen geleden)`);
  console.log('  Metingen totaal     :', data.measurements.length);
  console.log('  Volgers nu          :', data.current ? data.current.followers.length : 0);
  console.log('  Volgend nu          :', data.current ? data.current.following.length : 0);
  console.log('  Events vastgelegd   :', data.events.length);
  console.log('  Bestandsgrootte     :', Math.round(file.text.length / 1024), 'KB');
  console.log('');
}

main().catch((err) => {
  console.error('Status ophalen mislukt:', err.message);
  process.exit(1);
});
