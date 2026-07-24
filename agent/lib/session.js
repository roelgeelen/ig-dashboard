// Browsersessie met opgeslagen login. Een persistent context bewaart cookies,
// localStorage en device-fingerprint in dezelfde map, zodat Instagram de browser
// herkent als hetzelfde apparaat en niet elke run om een 2FA-code vraagt.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SESSION_DIR = path.join(__dirname, '..', '.session');
const DEBUG_DIR = path.join(__dirname, '..', 'debug');
const DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads');

class SessionExpiredError extends Error {
  constructor(msg) {
    super(msg || 'Instagram-sessie verlopen. Draai "npm run login" om opnieuw in te loggen.');
    this.name = 'SessionExpiredError';
  }
}

function ensureDirs() {
  for (const dir of [SESSION_DIR, DEBUG_DIR, DOWNLOAD_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function openContext({ headless = true } = {}) {
  ensureDirs();
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless,
    downloadsPath: DOWNLOAD_DIR,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
  });
  context.setDefaultTimeout(30000);
  return context;
}

async function screenshot(page, label) {
  ensureDirs();
  const safe = String(label).replace(/[^a-z0-9-]/gi, '_');
  const file = path.join(DEBUG_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${safe}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return null;
  }
}

module.exports = {
  openContext,
  screenshot,
  SessionExpiredError,
  SESSION_DIR,
  DEBUG_DIR,
  DOWNLOAD_DIR,
};
