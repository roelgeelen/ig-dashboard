// Tests voor de pure logica: opslagformaat en export-parser.
// Bewust zonder testframework - node test/run-tests.js is genoeg.

const assert = require('assert');
const AdmZip = require('adm-zip');
const store = require('../lib/store');
const { parseExportZip, unixToDate, usernameFromHref } = require('../lib/parse');
const { encrypt, decrypt } = require('../../scripts/crypto-utils');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

function snap(date, followers, following) {
  return {
    date,
    followers: followers.map((u) => [u, '2026-01-01']),
    following: following.map((u) => [u, '2026-01-01']),
    pending: [],
    recentRequests: [],
    recentlyUnfollowed: [],
  };
}

function eventsOn(s, date) {
  return s.events.filter((e) => e[0] === date).map((e) => `${e[2]}${e[1]}`).sort();
}

console.log('\nstore.js');

test('eerste meting levert geen events op', () => {
  const { store: s, changes } = store.applySnapshot(store.emptyStore(), snap('2026-01-01', ['a', 'b'], ['b']));
  assert.strictEqual(changes.isFirst, true);
  assert.strictEqual(s.events.length, 0);
  assert.deepStrictEqual(s.measurements, ['2026-01-01']);
  assert.strictEqual(s.previous, null);
});

test('tweede meting legt winst en verlies vast', () => {
  let s = store.applySnapshot(store.emptyStore(), snap('2026-01-01', ['a', 'b'], ['b'])).store;
  const res = store.applySnapshot(s, snap('2026-01-05', ['b', 'c'], ['b', 'd']));
  assert.deepStrictEqual(res.changes.newFollowers, ['c']);
  assert.deepStrictEqual(res.changes.lostFollowers, ['a']);
  assert.deepStrictEqual(res.changes.newFollowing, ['d']);
  assert.deepStrictEqual(res.changes.unfollowedByYou, []);
  assert.deepStrictEqual(eventsOn(res.store, '2026-01-05'), ['f+c', 'f-a', 'g+d']);
});

test('tweede run op dezelfde dag vervangt de meting in plaats van te stapelen', () => {
  let s = store.applySnapshot(store.emptyStore(), snap('2026-01-01', ['a', 'b'], [])).store;
  s = store.applySnapshot(s, snap('2026-01-05', ['a', 'b', 'c'], [])).store;
  assert.deepStrictEqual(eventsOn(s, '2026-01-05'), ['f+c']);

  // Zelfde dag opnieuw, nu is ook 'd' erbij gekomen en 'a' weg.
  const again = store.applySnapshot(s, snap('2026-01-05', ['b', 'c', 'd'], []));
  assert.deepStrictEqual(eventsOn(again.store, '2026-01-05'), ['f+c', 'f+d', 'f-a']);
  assert.deepStrictEqual(again.store.measurements, ['2026-01-01', '2026-01-05']);
  assert.deepStrictEqual(again.changes.newFollowers.sort(), ['c', 'd']);
  assert.deepStrictEqual(again.changes.lostFollowers, ['a']);
});

test('previous blijft de stand van voor de huidige meting', () => {
  let s = store.applySnapshot(store.emptyStore(), snap('2026-01-01', ['a'], [])).store;
  s = store.applySnapshot(s, snap('2026-01-05', ['a', 'b'], [])).store;
  assert.deepStrictEqual(s.previous.followers, ['a']);
  assert.strictEqual(s.previous.date, '2026-01-01');
  assert.strictEqual(s.current.date, '2026-01-05');
});

test('v1-array migreert naar v2 met volledige event-historie', () => {
  const v1 = [
    snap('2026-01-01', ['a', 'b'], []),
    snap('2026-01-05', ['b', 'c'], []),
    snap('2026-01-09', ['c', 'd'], []),
  ];
  const s = store.normalize(v1);
  assert.strictEqual(s.v, 2);
  assert.deepStrictEqual(s.measurements, ['2026-01-01', '2026-01-05', '2026-01-09']);
  assert.deepStrictEqual(eventsOn(s, '2026-01-05'), ['f+c', 'f-a']);
  assert.deepStrictEqual(eventsOn(s, '2026-01-09'), ['f+d', 'f-b']);
  assert.strictEqual(s.current.date, '2026-01-09');
});

test('daysSinceLastMeasurement rekent in hele dagen', () => {
  const s = store.applySnapshot(store.emptyStore(), snap('2026-01-01', ['a'], [])).store;
  assert.strictEqual(store.daysSinceLastMeasurement(s, '2026-01-01'), 0);
  assert.strictEqual(store.daysSinceLastMeasurement(s, '2026-01-05'), 4);
  assert.strictEqual(store.daysSinceLastMeasurement(store.emptyStore(), '2026-01-05'), Infinity);
});

test('event-log groeit niet mee met de lijstgrootte', () => {
  const many = Array.from({ length: 1500 }, (_, i) => 'user' + i);
  let s = store.applySnapshot(store.emptyStore(), snap('2026-01-01', many, many)).store;
  const before = JSON.stringify(s).length;
  // Twintig metingen waarbij er telkens een volger bij komt.
  for (let i = 0; i < 20; i++) {
    const day = `2026-02-${String(i + 1).padStart(2, '0')}`;
    s = store.applySnapshot(s, snap(day, many.concat(['nieuw' + i]), many)).store;
  }
  const after = JSON.stringify(s).length;
  // v1 zou hier 20x de volledige lijst hebben bijgeschreven (ruim 20x zo groot).
  assert.ok(after < before * 1.6, `store groeide te hard: ${before} -> ${after}`);
});

console.log('\nparse.js');

test('unixToDate en usernameFromHref', () => {
  assert.strictEqual(unixToDate(1769299200), '2026-01-25');
  assert.strictEqual(unixToDate(0), '');
  assert.strictEqual(usernameFromHref('https://www.instagram.com/someone'), 'someone');
  assert.strictEqual(usernameFromHref('https://www.instagram.com/_u/other'), 'other');
  assert.strictEqual(usernameFromHref(''), '');
});

function jsonRecord(username, name, ts, prefix) {
  return {
    title: name,
    media_list_data: [],
    string_list_data: [{ href: `https://www.instagram.com/${prefix || ''}${username}`, value: username, timestamp: ts }],
  };
}

function buildJsonZip() {
  const zip = new AdmZip();
  const base = 'connections/followers_and_following/';
  zip.addFile(
    base + 'followers_1.json',
    Buffer.from(JSON.stringify([jsonRecord('alice', 'Alice', 1769299200), jsonRecord('bob', 'Bob', 1769299200)]))
  );
  zip.addFile(
    base + 'followers_2.json',
    Buffer.from(JSON.stringify([jsonRecord('bob', 'Bob', 1769299200), jsonRecord('carol', 'Carol', 1769299200)]))
  );
  zip.addFile(
    base + 'following.json',
    Buffer.from(JSON.stringify({ relationships_following: [jsonRecord('bob', 'Bob', 1769299200, '_u/')] }))
  );
  zip.addFile(
    base + 'pending_follow_requests.json',
    Buffer.from(JSON.stringify({ relationships_follow_requests_sent: [jsonRecord('dave', 'Dave', 1769299200)] }))
  );
  zip.addFile(
    base + 'recently_unfollowed_profiles.json',
    Buffer.from(JSON.stringify({ relationships_unfollowed_users: [jsonRecord('erin', 'Erin', 1769299200)] }))
  );
  return zip.toBuffer();
}

test('JSON-export wordt gelezen, over meerdere bestanden en zonder duplicaten', () => {
  const parsed = parseExportZip(buildJsonZip(), '2026-07-24');
  assert.deepStrictEqual(parsed.followers.map((p) => p[0]), ['alice', 'bob', 'carol']);
  assert.deepStrictEqual(parsed.following.map((p) => p[0]), ['bob']);
  assert.strictEqual(parsed.followers[0][1], '2026-01-25');
  assert.strictEqual(parsed.date, '2026-07-24');
});

test('verzoeklijsten komen als [username, naam, datum]', () => {
  const parsed = parseExportZip(buildJsonZip(), '2026-07-24');
  assert.deepStrictEqual(parsed.pending, [['dave', 'Dave', '2026-01-25']]);
  assert.deepStrictEqual(parsed.recentlyUnfollowed, [['erin', 'Erin', '2026-01-25']]);
  assert.deepStrictEqual(parsed.recentRequests, []);
});

test('HTML-export blijft werken als vangnet', () => {
  const zip = new AdmZip();
  const base = 'connections/followers_and_following/';
  zip.addFile(
    base + 'followers_1.html',
    Buffer.from(
      '<a target="_blank" href="https://www.instagram.com/alice">alice</a></div><div>24 jul 2026</div>' +
        '<a target="_blank" href="https://www.instagram.com/bob">bob</a></div><div>25 jul 2026</div>'
    )
  );
  zip.addFile(
    base + 'following.html',
    Buffer.from('<a target="_blank" href="https://www.instagram.com/_u/bob">bob</a></div><div>1 jan 2026</div>')
  );
  const parsed = parseExportZip(zip.toBuffer(), '2026-07-24');
  assert.deepStrictEqual(parsed.followers, [['alice', '24 jul 2026'], ['bob', '25 jul 2026']]);
  assert.deepStrictEqual(parsed.following, [['bob', '1 jan 2026']]);
});

test('een zip zonder volgerslijst geeft een duidelijke fout', () => {
  const zip = new AdmZip();
  zip.addFile('messages/inbox/iets.json', Buffer.from('{}'));
  assert.throws(() => parseExportZip(zip.toBuffer(), '2026-07-24'), /Kon volgers\/volgend niet vinden/);
});

console.log('\ncrypto-compatibiliteit (agent <-> dashboard)');

test('encrypt/decrypt rondrit met het v2-formaat', () => {
  const s = store.applySnapshot(store.emptyStore(), snap('2026-01-01', ['a', 'b'], ['b'])).store;
  const roundtrip = decrypt('geheim', encrypt('geheim', s));
  assert.deepStrictEqual(roundtrip, s);
});

test('verkeerde passphrase faalt in plaats van rommel terug te geven', () => {
  const blob = encrypt('goed', { hallo: 'wereld' });
  assert.throws(() => decrypt('fout', blob));
});

console.log('');
console.log(`${passed} geslaagd, ${failed} mislukt`);
process.exit(failed ? 1 : 0);
