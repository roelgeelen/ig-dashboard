// Eenmalige inrichting. Doet alles wat zonder jouw Instagram-wachtwoord kan:
// passphrase controleren, .env schrijven, een bestaande export inlezen en de
// dagelijkse taak inplannen.
//
//   node setup.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync, execSync } = require('child_process');
const { decrypt } = require('../scripts/crypto-utils');

const AGENT_DIR = __dirname;
const REPO_DIR = path.join(AGENT_DIR, '..');
const ENV_FILE = path.join(AGENT_DIR, '.env');
const HISTORY_FILE = path.join(REPO_DIR, 'data', 'history.enc.json');

function say(msg) {
  console.log(msg);
}

// Leest een regel zonder hem op het scherm te zetten, zodat je passphrase niet
// in je terminal-scrollback blijft staan.
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) {
        process.stdin.removeListener('data', onData);
      } else {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question);
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// De passphrase is goed als hij de bestaande geschiedenis kan ontsleutelen.
// Beter dan hem klakkeloos wegschrijven en pas over vier dagen ontdekken dat
// er een typefout in zat.
function passphraseWorks(pass) {
  try {
    const blob = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    const data = decrypt(pass, blob.data);
    return Array.isArray(data);
  } catch {
    return false;
  }
}

function ghToken() {
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    }).trim();
  } catch {
    return '';
  }
}

function findExportZip() {
  const dir = path.join(REPO_DIR, '..', 'exports');
  try {
    const zips = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.zip'))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return zips[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  say('');
  say('  Agent inrichten');
  say('  ===============');
  say('');

  // ---- 1. GitHub ----
  const token = ghToken();
  if (token) {
    say('  [1/4] GitHub      : ingelogd via de gh CLI, geen token nodig.');
  } else {
    say('  [1/4] GitHub      : gh CLI niet ingelogd.');
    say('        Draai eerst "gh auth login" en start dit script opnieuw.');
    process.exit(1);
  }

  // ---- 2. Passphrase ----
  if (!fs.existsSync(HISTORY_FILE)) {
    say('  [2/4] Passphrase  : data/history.enc.json ontbreekt, kan niet controleren.');
    process.exit(1);
  }

  let passphrase = '';
  for (let poging = 1; poging <= 3; poging++) {
    passphrase = await askHidden('  [2/4] Passphrase  : ');
    if (!passphrase) {
      say('        Niets ingevuld.');
      continue;
    }
    if (passphraseWorks(passphrase)) {
      say('        Klopt - de bestaande geschiedenis is ermee te lezen.');
      break;
    }
    say('        Onjuist: hiermee is data/history.enc.json niet te ontsleutelen.');
    passphrase = '';
  }
  if (!passphrase) {
    say('');
    say('  Gestopt. Dit is dezelfde passphrase als waarmee je het dashboard ontgrendelt.');
    process.exit(1);
  }

  const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  if (existing && !/^\s*$/.test(existing)) {
    fs.writeFileSync(ENV_FILE + '.bak', existing);
  }
  fs.writeFileSync(
    ENV_FILE,
    [
      '# Aangemaakt door setup.js. Staat in .gitignore.',
      `ENCRYPTION_PASSPHRASE=${passphrase}`,
      '# GITHUB_TOKEN wordt automatisch opgehaald via de gh CLI.',
      'EXPORT_INTERVAL_DAYS=4',
      '',
    ].join('\n')
  );
  say('        Opgeslagen in agent/.env (staat in .gitignore).');

  // ---- 3. Basismeting ----
  const zip = findExportZip();
  if (zip) {
    say('');
    say('  [3/4] Basismeting : export gevonden - ' + path.basename(zip));
    const antwoord = await ask('        Nu inlezen zodat je meteen namen ziet? [J/n] ');
    if (!/^n/i.test(antwoord)) {
      try {
        execSync(`node seed.js "${zip}"`, { cwd: AGENT_DIR, stdio: 'inherit' });
      } catch {
        say('        Inlezen mislukt. Je kunt het later opnieuw proberen met: node seed.js "<pad>"');
      }
    } else {
      say('        Overgeslagen.');
    }
  } else {
    say('');
    say('  [3/4] Basismeting : geen export-zip gevonden in de map exports/, overgeslagen.');
  }

  // ---- 4. Geplande taak ----
  say('');
  const antwoord = await ask('  [4/4] Dagelijkse taak in Windows Taakplanner zetten? [J/n] ');
  if (!/^n/i.test(antwoord)) {
    try {
      execSync('powershell -ExecutionPolicy Bypass -File install-task.ps1', { cwd: AGENT_DIR, stdio: 'inherit' });
    } catch {
      say('        Inplannen mislukt. Handmatig: powershell -ExecutionPolicy Bypass -File .\\install-task.ps1');
    }
  } else {
    say('        Overgeslagen.');
  }

  say('');
  say('  Klaar. Nog een ding, en dat kan alleen jij:');
  say('');
  say('     npm run login');
  say('');
  say('  Daar opent een browservenster waarin jij inlogt op Instagram. Je');
  say('  wachtwoord gaat nergens anders heen. Daarna draait de rest vanzelf.');
  say('');
}

main().catch((err) => {
  console.error('Setup mislukt: ' + err.message);
  process.exit(1);
});
