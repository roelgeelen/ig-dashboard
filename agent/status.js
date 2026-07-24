// Laat per account zien wat de agent aan het doen is, zonder iets te wijzigen.

const env = require('./lib/env');
const state = require('./lib/state');
const store = require('./lib/store');
const github = require('./lib/github');
const { loadAccounts } = require('./lib/accounts');
const { decrypt } = require('../scripts/crypto-utils');

function fmt(v) {
  return v === null || v === undefined || v === '' ? '—' : v;
}

async function reportAccount(cfg, acc, sub) {
  console.log('');
  console.log(`  ${acc.label} (${acc.slug})`);
  console.log('  ' + '-'.repeat(acc.label.length + acc.slug.length + 3));
  console.log('  Fase                :', sub.phase);
  console.log('  Export aangevraagd  :', fmt(sub.requestedAt));
  console.log('  Laatste succes      :', fmt(sub.lastSuccessDate));
  console.log('  Sessie geldig       :', sub.sessionValid ? 'ja' : 'NEE - draai "npm run login"');
  console.log('  Mislukte runs op rij:', sub.consecutiveFailures || 0);
  console.log('  Laatste fout        :', fmt(sub.lastError));

  const file = await github.getFile(cfg.githubToken, `data/${acc.slug}/names.enc.json`);
  if (!file) {
    console.log('  Naamlijst           : nog geen op GitHub.');
    return;
  }
  const data = store.normalize(decrypt(cfg.passphrase, JSON.parse(file.text).data));
  const last = store.lastMeasurementDate(data);
  console.log('  Laatste meting      :', fmt(last), `(${store.daysSinceLastMeasurement(data, new Date().toISOString().slice(0, 10))} dagen geleden)`);
  console.log('  Metingen / events   :', `${data.measurements.length} / ${data.events.length}`);
  console.log('  Volgers / volgend   :', `${data.current ? data.current.followers.length : 0} / ${data.current ? data.current.following.length : 0}`);
  console.log('  Bestandsgrootte     :', Math.round(file.text.length / 1024), 'KB');
}

async function main() {
  const cfg = env.load();
  const { accounts, default: defaultSlug } = await loadAccounts(cfg);
  const s = state.load();

  console.log('');
  console.log('  Agent-status');
  console.log('  ============');
  console.log('  Laatste run         :', fmt(s.lastRunAt));

  for (const acc of accounts) {
    const sub = state.forAccount(s, acc.slug, acc.slug === defaultSlug);
    await reportAccount(cfg, acc, sub);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Status ophalen mislukt:', err.message);
  process.exit(1);
});
