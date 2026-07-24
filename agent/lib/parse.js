// Leest een Instagram "Volgers en gevolgde accounts"-export uit en normaliseert
// die naar het formaat dat het dashboard verwacht.
//
// Voorkeur gaat uit naar JSON: die structuur is stabiel, terwijl de HTML-variant
// aan class-namen hangt die Meta zonder aankondiging wijzigt. De HTML-parser
// blijft bestaan zodat een handmatig gedownloade zip ook werkt.

const AdmZip = require('adm-zip');

const PATTERNS = {
  followers: /followers_and_following\/followers(_\d+)?\.(json|html)$/i,
  following: /followers_and_following\/following\.(json|html)$/i,
  pending: /pending_follow_requests\.(json|html)$/i,
  recentRequests: /recent_follow_requests\.(json|html)$/i,
  recentlyUnfollowed: /recently_unfollowed_profiles\.(json|html)$/i,
};

function entriesMatching(zip, regex) {
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && regex.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
}

function unixToDate(ts) {
  // Instagram zet 0 neer waar het de datum niet weet; dat is geen 1 januari 1970.
  if (!ts) return '';
  const ms = ts > 1e11 ? ts : ts * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// Instagram verpakt elke lijst als array van
//   { title, string_list_data: [{ href, value, timestamp }] }
// soms op topniveau, soms achter een sleutel als relationships_following.
function findRecordArray(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const key of Object.keys(json)) {
      if (Array.isArray(json[key])) return json[key];
    }
  }
  return [];
}

function usernameFromHref(href) {
  if (!href) return '';
  const m = String(href).match(/instagram\.com\/(?:_u\/)?([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : '';
}

function recordToEntry(rec) {
  const sld = (rec && rec.string_list_data && rec.string_list_data[0]) || {};
  const username = sld.value || usernameFromHref(sld.href);
  return {
    username: String(username || '').trim(),
    name: String((rec && rec.title) || '').trim(),
    date: unixToDate(sld.timestamp),
  };
}

function parseJsonList(text) {
  const json = JSON.parse(text);
  return findRecordArray(json).map(recordToEntry).filter((e) => e.username);
}

// ---- HTML-varianten (vangnet voor handmatig gedownloade exports) ----

function parseFollowersHtml(text) {
  const re = /<a target="_blank" href="https:\/\/www\.instagram\.com\/([^"]+)">[^<]*<\/a><\/div><div>([^<]+)<\/div>/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push({ username: m[1], name: '', date: m[2] });
  return out;
}

function parseFollowingHtml(text) {
  const re = /<a target="_blank" href="https:\/\/www\.instagram\.com\/_u\/([^"]+)">[^<]*<\/a><\/div><div>([^<]+)<\/div>/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push({ username: m[1], name: '', date: m[2] });
  return out;
}

function parseRequestStyleHtml(text) {
  const blockRe = /<table style="table-layout: fixed;">([\s\S]*?)<\/table>[\s\S]*?<div class="_3-94 _a6-o">([^<]+)<\/div>/g;
  const rowRe = /<td class="_a6_q">([^<]+)<\/td><td class="_2piu _a6_r">([^<]*)<\/td>/g;
  const out = [];
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const table = m[1];
    const ts = m[2];
    const fields = {};
    let rm;
    rowRe.lastIndex = 0;
    while ((rm = rowRe.exec(table)) !== null) fields[rm[1]] = rm[2];
    out.push({ username: fields['Gebruikersnaam'] || '', name: fields['Naam'] || '', date: ts });
  }
  return out;
}

function readList(zip, kind) {
  const entries = entriesMatching(zip, PATTERNS[kind]);
  const out = [];
  for (const entry of entries) {
    const text = entry.getData().toString('utf8');
    const isJson = /\.json$/i.test(entry.entryName);
    let parsed;
    if (isJson) {
      parsed = parseJsonList(text);
    } else if (kind === 'followers') {
      parsed = parseFollowersHtml(text);
    } else if (kind === 'following') {
      parsed = parseFollowingHtml(text);
    } else {
      parsed = parseRequestStyleHtml(text);
    }
    out.push(...parsed);
  }
  // Een username kan in meerdere bestanden voorkomen (followers_1, followers_2).
  const seen = new Set();
  return out.filter((e) => {
    if (!e.username || seen.has(e.username)) return false;
    seen.add(e.username);
    return true;
  });
}

// Het dashboard leest volgers/volgend als [username, sinds] en de verzoeklijsten
// als [username, naam, datum].
function toPairs(list) {
  return list.map((e) => [e.username, e.date || '—']);
}

function toTriples(list) {
  return list.map((e) => [e.username, e.name || '', e.date || '—']);
}

function parseExportZip(buffer, date) {
  const zip = new AdmZip(buffer);

  const followers = readList(zip, 'followers');
  const following = readList(zip, 'following');

  if (!followers.length || !following.length) {
    const names = zip
      .getEntries()
      .filter((e) => !e.isDirectory)
      .map((e) => e.entryName)
      .slice(0, 20);
    throw new Error(
      'Kon volgers/volgend niet vinden in de export. Gevonden bestanden (max 20): ' + names.join(', ')
    );
  }

  return {
    date: date || new Date().toISOString().slice(0, 10),
    followers: toPairs(followers),
    following: toPairs(following),
    pending: toTriples(readList(zip, 'pending')),
    recentRequests: toTriples(readList(zip, 'recentRequests')),
    recentlyUnfollowed: toTriples(readList(zip, 'recentlyUnfollowed')),
  };
}

module.exports = { parseExportZip, unixToDate, usernameFromHref, findRecordArray };
