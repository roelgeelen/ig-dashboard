// Leest het accountoverzicht (data/accounts.json) dat bepaalt welke Instagram-
// accounts het dashboard volgt. Bewust platte tekst en niet versleuteld: het
// bevat alleen je eigen publieke gebruikersnamen, geen volgers- of naamdata.
// Daardoor kan het dashboard de profielswitcher al tonen voordat je ontgrendelt.

const fs = require('fs');
const path = require('path');

const ACCOUNTS_FILE = path.join(__dirname, '..', 'data', 'accounts.json');

// Zet een gebruikersnaam om naar een mapnaam die veilig op schijf en in een URL
// kan: alleen kleine letters, cijfers en underscores. "launchlygo.app" -> "launchlygo_app".
function slugify(username) {
  return String(username || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function readAccounts() {
  const manifest = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  const accounts = (manifest.accounts || []).map((a) => ({
    slug: a.slug || slugify(a.username),
    username: a.username,
    label: a.label || '@' + a.username,
  }));
  if (!accounts.length) throw new Error('Geen accounts gedefinieerd in data/accounts.json.');
  return { accounts, default: manifest.default || accounts[0].slug };
}

module.exports = { readAccounts, slugify, ACCOUNTS_FILE };
