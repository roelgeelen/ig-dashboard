const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto-utils');

const PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;
if (!PASSPHRASE) {
  console.error('ENCRYPTION_PASSPHRASE ontbreekt als environment variable / secret.');
  process.exit(1);
}

const TOKEN_FILE = path.join(__dirname, '..', 'data', 'token.enc.json');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.enc.json');

async function main() {
  const tokenBlob = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const tokenData = decrypt(PASSPHRASE, tokenBlob.data);
  const currentToken = tokenData.access_token;

  console.log('Token verversen...');
  const refreshRes = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(currentToken)}`);
  const refreshJson = await refreshRes.json();
  if (refreshJson.error) {
    console.error('Token refresh mislukt:', JSON.stringify(refreshJson.error));
    process.exit(1);
  }
  const newToken = refreshJson.access_token;
  console.log('Token ververst, geldig voor', Math.round(refreshJson.expires_in / 86400), 'dagen');

  console.log('Volgersaantal ophalen...');
  const meRes = await fetch(`https://graph.instagram.com/v22.0/me?fields=id,username,followers_count,follows_count&access_token=${encodeURIComponent(newToken)}`);
  const meJson = await meRes.json();
  if (meJson.error) {
    console.error('Ophalen gegevens mislukt:', JSON.stringify(meJson.error));
    process.exit(1);
  }
  console.log('Opgehaald:', meJson.username, meJson.followers_count, meJson.follows_count);

  const newTokenData = {
    access_token: newToken,
    last_refreshed: new Date().toISOString(),
    expires_in_seconds: refreshJson.expires_in,
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ v: 1, data: encrypt(PASSPHRASE, newTokenData) }, null, 2) + '\n');

  let history = [];
  try {
    const historyBlob = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    history = decrypt(PASSPHRASE, historyBlob.data);
  } catch (e) {
    console.warn('Kon bestaande geschiedenis niet lezen, begin opnieuw:', e.message);
    history = [];
  }
  const today = new Date().toISOString().slice(0, 10);
  const entry = { date: today, followers_count: meJson.followers_count, follows_count: meJson.follows_count };
  const idx = history.findIndex(h => h.date === today);
  if (idx >= 0) history[idx] = entry; else history.push(entry);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({ v: 1, data: encrypt(PASSPHRASE, history) }, null, 2) + '\n');

  console.log('Klaar:', JSON.stringify(entry));
}

main().catch(err => {
  console.error('Onverwachte fout:', err);
  process.exit(1);
});
