const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'agent.log');
const MAX_BYTES = 512 * 1024;

function rotate() {
  try {
    if (fs.statSync(LOG_FILE).size > MAX_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    }
  } catch {
    // Bestaat nog niet - niets te roteren.
  }
}

function write(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  console.log(line);
  try {
    rotate();
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // Loggen mag de agent nooit laten struikelen.
  }
}

module.exports = {
  info: (m) => write('INFO', m),
  warn: (m) => write('WARN', m),
  error: (m) => write('ERROR', m),
  LOG_FILE,
};
