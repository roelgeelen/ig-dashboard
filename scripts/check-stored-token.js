// Controleert het al opgeslagen, versleutelde token van een account op zijn
// rechten — zonder Meta of de GitHub Action. Ontsleutelt data/<slug>/token.enc.json
// met je passphrase en test of het insights mag ophalen.
//
//   ENCRYPTION_PASSPHRASE=<jouw-dashboard-passphrase> \
//     node scripts/check-stored-token.js dutch_718_gts
//
// Zonder accountnaam wordt het standaardaccount uit data/accounts.json gebruikt.
// Slaat niets op, ververst niets — alleen lezen.

const fs = require('fs');
const path = require('path');
const { decrypt } = require('./crypto-utils');
const { readAccounts, slugify } = require('./accounts');
const { checkToken } = require('./check-token');

const PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;

async function main() {
  if (!PASSPHRASE) {
    console.error('ENCRYPTION_PASSPHRASE ontbreekt. Zet dezelfde passphrase als waarmee je het dashboard ontgrendelt.');
    process.exit(1);
  }
  const slug = process.argv[2] ? slugify(process.argv[2]) : readAccounts().default;
  const tokenFile = path.join(__dirname, '..', 'data', slug, 'token.enc.json');
  if (!fs.existsSync(tokenFile)) {
    console.error(`Geen opgeslagen token gevonden voor "${slug}" (${tokenFile}).`);
    process.exit(1);
  }

  let token;
  try {
    const blob = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    token = decrypt(PASSPHRASE, blob.data).access_token;
  } catch (e) {
    console.error('Kon het token niet ontsleutelen — klopt de passphrase?');
    process.exit(1);
  }

  console.log(`Opgeslagen token van "${slug}" controleren...\n`);
  const res = await checkToken(token);
  process.exit(res.ok ? (res.hasInsights ? 0 : 2) : 1);
}

main().catch((e) => { console.error('Onverwachte fout:', e.message || e); process.exit(1); });
