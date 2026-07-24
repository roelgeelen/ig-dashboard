// Loopt de export-wizard door en drukt af wat er op elk scherm staat, zodat de
// echte labels in selectors.json kunnen. Verstuurt niets: het laatste scherm
// wordt alleen gelezen, niet bevestigd.
//
//   node explore.js "Je gegevens exporteren" "Bepaalde informatie"

const { openContext, screenshot } = require('./lib/session');

const DYI = 'https://accountscenter.instagram.com/info_and_permissions/dyi/';

async function dump(page, label) {
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const clickable = [...document.querySelectorAll('[role=button],button,a[role=link],[role=radio],[role=checkbox]')]
      .filter(vis)
      .map(txt)
      .filter((t) => t && t.length < 80);
    return {
      url: location.href,
      heading: [...document.querySelectorAll('h1,h2,h3,[role=heading]')].filter(vis).map(txt).slice(0, 5),
      clickable: [...new Set(clickable)].slice(0, 30),
    };
  });
  console.log('\n=== na: ' + label + ' ===');
  console.log('url      :', info.url);
  console.log('koppen   :', JSON.stringify(info.heading));
  console.log('klikbaar :');
  for (const c of info.clickable) console.log('   - ' + c);
  await screenshot(page, 'explore-' + label);
}

// Alleen echte klikbare elementen, en het kleinste dat past. Zoeken op losse
// tekst pakt hier de uitleg-alinea in plaats van de knop, en dan blijft
// Playwright dertig seconden proberen op iets dat nooit gaat werken.
async function clickText(page, text) {
  const handle = await page.evaluateHandle((t) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const target = norm(t);
    const cands = [...document.querySelectorAll('[role=button],button,a,[role=link],[role=radio],[role=checkbox],[role=menuitem],[role=tab]')].filter(vis);
    const exact = cands.filter((el) => norm(el.innerText) === target);
    const partial = cands.filter((el) => norm(el.innerText).includes(target));
    const pick = (list) => list.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length)[0];
    return pick(exact) || pick(partial) || null;
  }, text);

  const el = handle.asElement();
  if (!el) return false;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ timeout: 15000 }).catch(async () => {
    await el.evaluate((n) => n.click());
  });
  return true;
}

async function main() {
  const steps = process.argv.slice(2);
  const ctx = await openContext({ headless: true });
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.goto(DYI, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await dump(page, 'start');

  for (const step of steps) {
    const ok = await clickText(page, step);
    if (!ok) {
      console.log(`\n!! "${step}" niet gevonden - gestopt.`);
      break;
    }
    await dump(page, step);
  }

  await ctx.close();
}

main().catch((e) => {
  console.error('FOUT:', e.message);
  process.exit(1);
});
