const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto-utils');
const { readAccounts } = require('./accounts');

const PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;
if (!PASSPHRASE) {
  console.error('ENCRYPTION_PASSPHRASE ontbreekt als environment variable / secret.');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data');

// Haalt voor één account het volgersaantal op en werkt de geschiedenis bij.
// Geeft true terug als het gelukt is, false als het account (nog) geen token
// heeft en dus overgeslagen wordt.
async function updateAccount(account) {
  const dir = path.join(DATA_DIR, account.slug);
  const tokenFile = path.join(dir, 'token.enc.json');
  const historyFile = path.join(dir, 'history.enc.json');

  if (!fs.existsSync(tokenFile)) {
    console.log(`[${account.slug}] Nog geen token ingesteld, overgeslagen. ` +
      `Zet er een met: ENCRYPTION_PASSPHRASE=... node scripts/set-token.js ${account.username} <access_token>`);
    return false;
  }

  console.log(`[${account.slug}] Token verversen...`);
  const tokenBlob = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  const currentToken = decrypt(PASSPHRASE, tokenBlob.data).access_token;

  const refreshRes = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(currentToken)}`);
  const refreshJson = await refreshRes.json();
  if (refreshJson.error) {
    throw new Error(`[${account.slug}] Token refresh mislukt: ${JSON.stringify(refreshJson.error)}`);
  }
  const newToken = refreshJson.access_token;
  console.log(`[${account.slug}] Token ververst, geldig voor`, Math.round(refreshJson.expires_in / 86400), 'dagen');

  console.log(`[${account.slug}] Volgersaantal ophalen...`);
  const meRes = await fetch(`https://graph.instagram.com/v22.0/me?fields=id,username,followers_count,follows_count&access_token=${encodeURIComponent(newToken)}`);
  const meJson = await meRes.json();
  if (meJson.error) {
    throw new Error(`[${account.slug}] Ophalen gegevens mislukt: ${JSON.stringify(meJson.error)}`);
  }
  console.log(`[${account.slug}] Opgehaald:`, meJson.username, meJson.followers_count, meJson.follows_count);

  const newTokenData = {
    access_token: newToken,
    last_refreshed: new Date().toISOString(),
    expires_in_seconds: refreshJson.expires_in,
  };
  fs.writeFileSync(tokenFile, JSON.stringify({ v: 1, data: encrypt(PASSPHRASE, newTokenData) }, null, 2) + '\n');

  let history = [];
  try {
    const historyBlob = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    history = decrypt(PASSPHRASE, historyBlob.data);
  } catch (e) {
    console.warn(`[${account.slug}] Kon bestaande geschiedenis niet lezen, begin opnieuw:`, e.message);
    history = [];
  }
  const today = new Date().toISOString().slice(0, 10);
  const entry = { date: today, followers_count: meJson.followers_count, follows_count: meJson.follows_count };
  const idx = history.findIndex(h => h.date === today);
  if (idx >= 0) history[idx] = entry; else history.push(entry);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify({ v: 1, data: encrypt(PASSPHRASE, history) }, null, 2) + '\n');

  console.log(`[${account.slug}] Klaar:`, JSON.stringify(entry));
  return true;
}

async function main() {
  const { accounts } = readAccounts();
  let failures = 0;

  // Elk account los verwerken: een fout of ontbrekend token bij het ene account
  // mag het andere niet blokkeren.
  for (const account of accounts) {
    try {
      await updateAccount(account);
    } catch (err) {
      failures++;
      console.error(err.message || err);
    }
  }

  if (failures) {
    console.error(`${failures} account(s) faalden.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Onverwachte fout:', err);
  process.exit(1);
});
