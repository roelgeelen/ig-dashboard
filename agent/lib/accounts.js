// Welke Instagram-accounts moet de agent bijwerken? Dat staat in
// data/accounts.json in de repo. De agent leest dat van GitHub (net als de
// naamlijsten), zodat een lokaal verouderde werkkopie niet uitmaakt.
//
// Valt terug op IG_USERNAME uit .env als het manifest nog niet bestaat, zodat
// een oude installatie zonder wijzigingen blijft draaien.

const github = require('./github');

function slugify(username) {
  return String(username || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function loadAccounts(cfg) {
  const file = await github.getFile(cfg.githubToken, 'data/accounts.json');
  if (file) {
    const m = JSON.parse(file.text);
    const accounts = (m.accounts || []).map((a) => ({
      slug: a.slug || slugify(a.username),
      username: a.username,
      label: a.label || '@' + a.username,
    }));
    if (accounts.length) {
      const def = m.default && accounts.some((a) => a.slug === m.default) ? m.default : accounts[0].slug;
      return { accounts, default: def };
    }
  }
  if (cfg.username) {
    const slug = slugify(cfg.username);
    return { accounts: [{ slug, username: cfg.username, label: '@' + cfg.username }], default: slug };
  }
  throw new Error('Geen accounts gevonden: data/accounts.json ontbreekt op GitHub en IG_USERNAME is niet ingesteld in agent/.env.');
}

module.exports = { loadAccounts, slugify };
