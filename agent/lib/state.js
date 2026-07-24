// Lokale staat van de agent. Blijft op je PC staan (gitignored) omdat het
// alleen over de lopende export-aanvraag gaat, niet over dashboard-data.

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'state.json');

const IDLE = 'IDLE';
const PENDING = 'PENDING';

function defaults() {
  return {
    phase: IDLE,
    requestedAt: null,       // ISO-tijd waarop de export is aangevraagd
    lastSuccessDate: null,   // datum van de laatst verwerkte export
    lastRunAt: null,
    lastError: null,
    sessionValid: true,
    consecutiveFailures: 0,
  };
}

function load() {
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return defaults();
  }
}

function save(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

module.exports = { load, save, defaults, IDLE, PENDING, STATE_FILE };
