// Minimale .env-lezer. Een dependency erbij halen voor twaalf regels parsing
// is niet de moeite waard.

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

function load() {
  let fromFile = {};
  try {
    const text = fs.readFileSync(ENV_FILE, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
      fromFile[key] = value;
    }
  } catch {
    // Geen .env - dan moeten de waarden uit de omgeving komen.
  }

  const cfg = {
    passphrase: process.env.ENCRYPTION_PASSPHRASE || fromFile.ENCRYPTION_PASSPHRASE || '',
    githubToken: process.env.GITHUB_TOKEN || fromFile.GITHUB_TOKEN || '',
    intervalDays: Number(process.env.EXPORT_INTERVAL_DAYS || fromFile.EXPORT_INTERVAL_DAYS || 4),
  };

  const missing = [];
  if (!cfg.passphrase) missing.push('ENCRYPTION_PASSPHRASE');
  if (!cfg.githubToken) missing.push('GITHUB_TOKEN');
  if (missing.length) {
    throw new Error(
      `Ontbrekende instellingen: ${missing.join(', ')}. Kopieer agent/.env.example naar agent/.env en vul ze in.`
    );
  }
  if (!Number.isFinite(cfg.intervalDays) || cfg.intervalDays < 4) {
    // Instagram staat maximaal een export per vier dagen toe; sneller vragen
    // levert alleen afgewezen verzoeken op.
    cfg.intervalDays = 4;
  }
  return cfg;
}

module.exports = { load, ENV_FILE };
