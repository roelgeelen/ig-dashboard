// Eenmalige (en later per kwartaal herhaalde) login. Opent een zichtbare
// browser waarin jij zelf inlogt - de agent raakt je wachtwoord nooit aan.
// De sessie blijft daarna in agent/.session/ staan.

const { openContext } = require('./lib/session');
const log = require('./lib/log');

const DYI_URL = 'https://accountscenter.instagram.com/info_and_permissions/dyi/';

async function main() {
  console.log('');
  console.log('  Er opent nu een browservenster.');
  console.log('  Log daarin in op Instagram (inclusief 2FA als daarom gevraagd wordt).');
  console.log('  Kies "Ja"/"Onthouden" als gevraagd wordt of je ingelogd wilt blijven.');
  console.log('  Sluit het venster zodra je de downloadpagina ziet - de sessie is dan opgeslagen.');
  console.log('');

  const context = await openContext({ headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(DYI_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  await new Promise((resolve) => {
    context.on('close', resolve);
    page.on('close', () => setTimeout(resolve, 1000));
  });

  log.info('Login-venster gesloten, sessie opgeslagen in agent/.session/.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Login mislukt:', err.message);
  process.exit(1);
});
