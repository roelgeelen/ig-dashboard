// Controleert een Instagram Graph API-token zonder iets op te slaan: werkt het,
// voor welk account, en heeft het de insights-rechten? Handig om een nieuw token
// te testen vóór je het met set-token.js klaarzet.
//
//   node scripts/check-token.js <access_token>
//
// Slaat niets op, ververst niets — alleen lezen.

const { fetchAccountInsights } = require('./insights');

const API_ROOT = 'https://graph.instagram.com/v22.0';

// Doet de controle en logt het resultaat. Geeft terug of de insights-rechten
// aanwezig zijn, zodat aanroepers een exitcode kunnen zetten. Gedeeld door
// check-token.js (los token) en check-stored-token.js (opgeslagen token).
async function checkToken(token) {
  const meRes = await fetch(`${API_ROOT}/me?fields=id,username,followers_count,follows_count,media_count&access_token=${encodeURIComponent(token)}`);
  const me = await meRes.json();
  if (me.error) {
    console.error('❌ Token werkt niet:', JSON.stringify(me.error));
    return { ok: false, hasInsights: false };
  }
  console.log(`✅ Token werkt voor @${me.username}`);
  console.log(`   ${me.followers_count} volgers · ${me.follows_count} volgend · ${me.media_count} berichten`);

  console.log('\nInsights-rechten controleren (bereik, weergaven, interacties)...');
  const ins = await fetchAccountInsights(me.id, token);
  const keys = Object.keys(ins);
  if (keys.length) {
    console.log('✅ Insights beschikbaar:', keys.join(', '));
    console.log('\n=> Dit token heeft alles wat het dashboard nodig heeft.');
    console.log(`   Zet het klaar met: ENCRYPTION_PASSPHRASE=<passphrase> node scripts/set-token.js ${me.username} <token>`);
    return { ok: true, hasInsights: true, username: me.username, metrics: keys };
  }
  console.log('⚠️  Geen insights beschikbaar — het token mist waarschijnlijk het recht');
  console.log('    instagram_business_manage_insights. De volgers/berichten werken wel,');
  console.log('    maar de sectie "Bereik & activiteit" blijft leeg. Maak het token');
  console.log('    opnieuw aan met dat recht erbij en test opnieuw.');
  return { ok: true, hasInsights: false, username: me.username, metrics: [] };
}

async function main() {
  const token = process.argv[2];
  if (!token) {
    console.error('Gebruik: node scripts/check-token.js <access_token>');
    process.exit(1);
  }
  const res = await checkToken(token);
  process.exit(res.ok ? (res.hasInsights ? 0 : 2) : 1);
}

if (require.main === module) {
  main().catch((e) => { console.error('Onverwachte fout:', e.message || e); process.exit(1); });
}

module.exports = { checkToken };
