// Lokale staat van de agent. Blijft op je PC staan (gitignored) omdat het
// alleen over de lopende export-aanvragen gaat, niet over dashboard-data.
//
// Sinds er meerdere accounts gevolgd kunnen worden, houdt elk account zijn eigen
// fase bij:
//
//   { lastRunAt, accounts: { <slug>: { phase, requestedAt, lastSuccessDate,
//                                       lastError, sessionValid, consecutiveFailures } } }

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'state.json');

const IDLE = 'IDLE';
const PENDING = 'PENDING';

function accountDefaults() {
  return {
    phase: IDLE,
    requestedAt: null,       // ISO-tijd waarop de export is aangevraagd
    lastSuccessDate: null,   // datum van de laatst verwerkte export
    lastError: null,
    sessionValid: true,
    consecutiveFailures: 0,
  };
}

function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    raw = {};
  }
  // Migratie van het oude platte formaat (één account) naar per-account. De
  // oude velden worden apart gezet en bij de eerste forAccount van het
  // standaardaccount overgenomen.
  if (raw && raw.phase && !raw.accounts) {
    const { phase, requestedAt, lastSuccessDate, lastError, sessionValid, consecutiveFailures } = raw;
    raw = {
      lastRunAt: raw.lastRunAt || null,
      accounts: {},
      _legacy: { phase, requestedAt, lastSuccessDate, lastError, sessionValid, consecutiveFailures },
    };
  }
  return { lastRunAt: null, accounts: {}, ...raw };
}

// Geeft de (mutabele) substate voor een account; maakt hem aan als hij ontbreekt.
// Voor het standaardaccount wordt een eventuele oude platte state overgenomen.
function forAccount(state, slug, isDefault) {
  if (!state.accounts[slug]) {
    if (isDefault && state._legacy) {
      state.accounts[slug] = { ...accountDefaults(), ...state._legacy };
      delete state._legacy;
    } else {
      state.accounts[slug] = accountDefaults();
    }
  }
  return state.accounts[slug];
}

function save(state) {
  const clean = { lastRunAt: state.lastRunAt || null, accounts: state.accounts || {} };
  fs.writeFileSync(STATE_FILE, JSON.stringify(clean, null, 2) + '\n');
}

module.exports = { load, save, forAccount, accountDefaults, IDLE, PENDING, STATE_FILE };
