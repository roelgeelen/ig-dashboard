const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto-utils');
const { readAccounts } = require('./accounts');
const { fetchAccountInsights, fetchTopPosts } = require('./insights');

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
  const insightsFile = path.join(dir, 'insights.enc.json');
  const postsFile = path.join(dir, 'posts.enc.json');

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
  // media_count komt uit dezelfde User-node en hoort bij de basisvelden, maar
  // niet elke token/accounttype levert hem. Daarom vragen we hem er optioneel
  // bij en vallen we bij een fout stil terug op de velden die er altijd zijn -
  // een ontbrekend berichtenaantal mag de dagelijkse meting nooit kosten.
  async function fetchMe(fields) {
    const res = await fetch(`https://graph.instagram.com/v22.0/me?fields=${fields}&access_token=${encodeURIComponent(newToken)}`);
    return res.json();
  }
  let meJson = await fetchMe('id,username,followers_count,follows_count,media_count');
  if (meJson.error) {
    console.warn(`[${account.slug}] Uitgebreide velden mislukt (${JSON.stringify(meJson.error)}), val terug op basisvelden.`);
    meJson = await fetchMe('id,username,followers_count,follows_count');
  }
  if (meJson.error) {
    throw new Error(`[${account.slug}] Ophalen gegevens mislukt: ${JSON.stringify(meJson.error)}`);
  }
  console.log(`[${account.slug}] Opgehaald:`, meJson.username, meJson.followers_count, meJson.follows_count, meJson.media_count != null ? `(${meJson.media_count} berichten)` : '');

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
  if (meJson.media_count != null) entry.media_count = meJson.media_count;
  const idx = history.findIndex(h => h.date === today);
  if (idx >= 0) history[idx] = entry; else history.push(entry);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify({ v: 1, data: encrypt(PASSPHRASE, history) }, null, 2) + '\n');

  console.log(`[${account.slug}] Klaar:`, JSON.stringify(entry));

  // Insights en best presterende berichten zijn een bonus bovenop de dagelijkse
  // aantallen: lukt het niet (bijvoorbeeld omdat het token de insights-rechten
  // mist), dan loggen we dat en gaan we door. Een lege insights is geen fout.
  await updateInsights(account, insightsFile, meJson.id, newToken, today);
  await updatePosts(account, postsFile, meJson.id, newToken, today);

  return true;
}

// Dagelijkse account-insights bijwerken (bereik, profielweergaven, interacties).
async function updateInsights(account, insightsFile, igId, token, today) {
  try {
    const ins = await fetchAccountInsights(igId, token);
    const keys = Object.keys(ins);
    if (!keys.length) {
      console.log(`[${account.slug}] Geen insights beschikbaar (token mist mogelijk de insights-rechten), overgeslagen.`);
      return;
    }
    let hist = [];
    try {
      const blob = JSON.parse(fs.readFileSync(insightsFile, 'utf8'));
      hist = decrypt(PASSPHRASE, blob.data);
      if (!Array.isArray(hist)) hist = [];
    } catch (e) { hist = []; }
    const rec = Object.assign({ date: today }, ins);
    const idx = hist.findIndex(h => h.date === today);
    if (idx >= 0) hist[idx] = rec; else hist.push(rec);
    fs.writeFileSync(insightsFile, JSON.stringify({ v: 1, data: encrypt(PASSPHRASE, hist) }, null, 2) + '\n');
    console.log(`[${account.slug}] Insights bijgewerkt: ${keys.join(', ')}.`);
  } catch (e) {
    console.warn(`[${account.slug}] Insights ophalen mislukt (overgeslagen):`, e.message || e);
  }
}

// Momentopname van de recente, best presterende berichten bijwerken.
async function updatePosts(account, postsFile, igId, token, today) {
  try {
    const posts = await fetchTopPosts(igId, token);
    if (!posts.length) {
      console.log(`[${account.slug}] Geen berichten opgehaald, overgeslagen.`);
      return;
    }
    const snapshot = { date: today, posts };
    fs.writeFileSync(postsFile, JSON.stringify({ v: 1, data: encrypt(PASSPHRASE, snapshot) }, null, 2) + '\n');
    console.log(`[${account.slug}] Berichten bijgewerkt: ${posts.length} stuks.`);
  } catch (e) {
    console.warn(`[${account.slug}] Berichten ophalen mislukt (overgeslagen):`, e.message || e);
  }
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
