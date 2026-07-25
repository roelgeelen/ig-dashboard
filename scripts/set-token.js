// Zet een Instagram Graph API-token voor een account klaar, versleuteld, zodat
// de dagelijkse GitHub Action het volgersaantal kan ophalen en het token elke
// dag zelf ververst. Draai dit één keer per account.
//
//   ENCRYPTION_PASSPHRASE=<jouw-dashboard-passphrase> \
//     node scripts/set-token.js launchlygo.app <long-lived-access-token>
//
// Daarna: het aangepaste bestand data/<slug>/token.enc.json committen en pushen.
// Vanaf dan draait alles automatisch, net als bij het eerste account.
//
// Benodigde rechten (scopes) bij het aanmaken van het token:
//   - instagram_business_basic            -> volgers, volgend, berichten
//   - instagram_business_manage_insights  -> bereik, profielweergaven, interacties
//                                            en de statistieken per bericht
// Zonder het tweede recht werkt alles behalve de sectie "Bereik & activiteit";
// die blijft leeg tot je het token opnieuw mét dat recht aanmaakt en hier klaarzet.

const fs = require('fs');
const path = require('path');
const { encrypt } = require('./crypto-utils');
const { readAccounts, slugify, ACCOUNTS_FILE } = require('./accounts');

const PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;

function main() {
  const username = process.argv[2];
  const token = process.argv[3];
  if (!username || !token) {
    console.error('Gebruik: ENCRYPTION_PASSPHRASE=... node scripts/set-token.js <gebruikersnaam> <access_token>');
    process.exit(1);
  }
  if (!PASSPHRASE) {
    console.error('ENCRYPTION_PASSPHRASE ontbreekt. Zet dezelfde passphrase als waarmee je het dashboard ontgrendelt.');
    process.exit(1);
  }

  const slug = slugify(username);

  // Account registreren in het manifest als het er nog niet in staat, zodat de
  // fetch-Action en het dashboard het meteen meenemen.
  const { accounts, default: def } = readAccounts();
  if (!accounts.some((a) => a.slug === slug)) {
    const manifest = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    manifest.accounts.push({ slug, username, label: '@' + username });
    if (!manifest.default) manifest.default = def || slug;
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Account "${username}" toegevoegd aan data/accounts.json.`);
  }

  const dir = path.join(__dirname, '..', 'data', slug);
  fs.mkdirSync(dir, { recursive: true });
  const tokenFile = path.join(dir, 'token.enc.json');

  const tokenData = {
    access_token: token,
    last_refreshed: new Date().toISOString(),
    expires_in_seconds: null,
  };
  fs.writeFileSync(tokenFile, JSON.stringify({ v: 1, data: encrypt(PASSPHRASE, tokenData) }, null, 2) + '\n');
  console.log(`Token versleuteld opgeslagen in data/${slug}/token.enc.json.`);
  console.log('Commit en push dit bestand; de dagelijkse Action doet de rest.');
}

main();
