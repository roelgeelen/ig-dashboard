// Eenmalig herstel van een run die rond middernacht (Nederlandse tijd) draaide en
// daardoor op de vorige dag belandde (de pijplijn schreef vroeger de UTC-datum weg;
// dat is inmiddels gefixt in fetch-and-update.js). Die run overschreef bovendien de
// entry van de vorige dag, want history/insights werken de entry van diezelfde datum
// bij. Dit script zet beide dagen weer goed:
//   1. de middernacht-meting krijgt de nieuwe (juiste) datum;
//   2. de oorspronkelijke waarde van de vorige dag wordt uit een oudere git-commit
//      teruggehaald en teruggeplaatst, zodat er geen gat in de reeks zit.
//
//   ENCRYPTION_PASSPHRASE=<jouw-dashboard-passphrase> \
//     node scripts/herstel-middernacht-run.js
//
// Standaard: 2026-07-27 -> 2026-07-28, oude waarde uit commit 5bde487. Anders:
//     node scripts/herstel-middernacht-run.js <foute-datum> <nieuwe-datum> <git-ref>
//
// Werkt op history.enc.json en insights.enc.json (dagreeksen). posts.enc.json is
// slechts één momentopname van de actuele topberichten, geen dagreeks: die krijgt
// alleen de nieuwe datum (geen oude momentopname terugzetten). Het script is veilig
// om nogmaals te draaien en gaat om met de staat waarin de foute datum al is verzet.
//
// Daarna: de gewijzigde data/<slug>/*.enc.json committen en pushen.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { encrypt, decrypt } = require('./crypto-utils');
const { readAccounts } = require('./accounts');

const PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPO_ROOT = path.join(__dirname, '..');

// Lees een bestand zoals het op een bepaalde git-commit stond; null als het daar
// niet bestond (bijv. een account dat later is toegevoegd).
function readAtRef(ref, relPath) {
  try {
    return execFileSync('git', ['show', `${ref}:${relPath}`], { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (e) {
    return null;
  }
}

function sortByDate(arr) {
  arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Herstel een dagreeks-bestand (history of insights).
function fixSeries(slug, relPath, badDate, newDate, ref, label) {
  const file = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(file)) return `${label}: bestand ontbreekt, overgeslagen.`;

  const blob = JSON.parse(fs.readFileSync(file, 'utf8'));
  const arr = decrypt(PASSPHRASE, blob.data);
  if (!Array.isArray(arr)) return `${label}: onverwacht formaat, overgeslagen.`;
  const notes = [];

  // 1. Middernacht-meting naar de nieuwe datum verzetten (tenzij die er al is).
  const bad = arr.find((h) => h.date === badDate);
  const hasNew = arr.some((h) => h.date === newDate);
  if (bad && !hasNew) {
    bad.date = newDate;
    notes.push(`${badDate} -> ${newDate}`);
  } else if (hasNew) {
    notes.push(`${newDate} bestond al`);
  }

  // 2. Oorspronkelijke waarde van de foute datum terughalen uit de oude commit,
  //    maar alleen als die datum nu ontbreekt (anders zouden we goede data overschrijven).
  if (!arr.some((h) => h.date === badDate)) {
    const raw = readAtRef(ref, relPath);
    if (!raw) {
      notes.push(`geen bron voor ${badDate} op ${ref}`);
    } else {
      const oldArr = decrypt(PASSPHRASE, JSON.parse(raw).data);
      const recovered = Array.isArray(oldArr) ? oldArr.find((h) => h.date === badDate) : null;
      if (recovered) {
        arr.push(recovered);
        notes.push(`${badDate} hersteld uit ${ref}`);
      } else {
        notes.push(`${badDate} niet gevonden in ${ref}`);
      }
    }
  }

  sortByDate(arr);
  fs.writeFileSync(file, JSON.stringify({ v: blob.v || 1, data: encrypt(PASSPHRASE, arr) }, null, 2) + '\n');
  return `${label}: ${notes.join('; ') || 'niets te doen'}.`;
}

// Herstel het posts-momentopnamebestand: alleen de datum verzetten.
function fixPosts(relPath, badDate, newDate) {
  const file = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(file)) return 'posts: bestand ontbreekt, overgeslagen.';
  const blob = JSON.parse(fs.readFileSync(file, 'utf8'));
  const snap = decrypt(PASSPHRASE, blob.data);
  if (!snap || snap.date !== badDate) return `posts: momentopname staat niet op ${badDate}, overgeslagen.`;
  snap.date = newDate;
  fs.writeFileSync(file, JSON.stringify({ v: blob.v || 1, data: encrypt(PASSPHRASE, snap) }, null, 2) + '\n');
  return `posts: ${badDate} -> ${newDate}.`;
}

function main() {
  const badDate = process.argv[2] || '2026-07-27';
  const newDate = process.argv[3] || '2026-07-28';
  const ref = process.argv[4] || '5bde487';
  if (!DATE_RE.test(badDate) || !DATE_RE.test(newDate)) {
    console.error('Gebruik: ENCRYPTION_PASSPHRASE=... node scripts/herstel-middernacht-run.js [foute-datum] [nieuwe-datum] [git-ref]');
    process.exit(1);
  }
  if (!PASSPHRASE) {
    console.error('ENCRYPTION_PASSPHRASE ontbreekt. Zet dezelfde passphrase als waarmee je het dashboard ontgrendelt.');
    process.exit(1);
  }

  const { accounts } = readAccounts();
  for (const account of accounts) {
    const base = `data/${account.slug}`;
    console.log(`\n[${account.slug}]`);
    console.log('  ' + fixSeries(account.slug, `${base}/history.enc.json`, badDate, newDate, ref, 'history'));
    console.log('  ' + fixSeries(account.slug, `${base}/insights.enc.json`, badDate, newDate, ref, 'insights'));
    console.log('  ' + fixPosts(`${base}/posts.enc.json`, badDate, newDate));
  }
  console.log('\nKlaar. Controleer met git diff en commit daarna de gewijzigde data/<slug>/*.enc.json bestanden.');
}

main();
