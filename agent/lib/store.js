// Opslagformaat v2 voor data/names.enc.json.
//
// v1 bewaarde bij elke meting de volledige volgerslijst. Bij ~90 metingen per
// jaar loopt dat op tot tientallen megabytes die de browser elke keer moet
// downloaden en ontsleutelen. v2 bewaart de huidige stand, de vorige stand
// (alleen usernames, nodig om een meting op dezelfde dag te kunnen overschrijven)
// en een compacte event-log.
//
// {
//   v: 2,
//   current:  { date, followers: [[user, sinds]], following: [[user, sinds]],
//               pending: [], recentRequests: [], recentlyUnfollowed: [] },
//   previous: { date, followers: [user], following: [user] } | null,
//   events:   [[date, username, type]],   type: 'f+' 'f-' 'g+' 'g-'
//   measurements: [date]
// }

const EVENT_FOLLOWER_GAINED = 'f+';
const EVENT_FOLLOWER_LOST = 'f-';
const EVENT_FOLLOWING_ADDED = 'g+';
const EVENT_FOLLOWING_REMOVED = 'g-';

function emptyStore() {
  return { v: 2, current: null, previous: null, events: [], measurements: [] };
}

function usernames(pairs) {
  return (pairs || []).map((p) => (Array.isArray(p) ? p[0] : p));
}

// v1 was een kale array van snapshots. Bouw daar een v2-store uit op door de
// snapshots in volgorde toe te passen.
function migrateV1(snapshots) {
  let store = emptyStore();
  for (const snap of snapshots) store = applySnapshot(store, snap).store;
  return store;
}

function normalize(raw) {
  if (!raw) return emptyStore();
  if (Array.isArray(raw)) return migrateV1(raw);
  if (raw.v === 2) {
    return {
      v: 2,
      current: raw.current || null,
      previous: raw.previous || null,
      events: raw.events || [],
      measurements: raw.measurements || [],
    };
  }
  throw new Error('Onbekend opslagformaat in names.enc.json (v=' + raw.v + ')');
}

function diffUsers(baseList, nextList) {
  const base = new Set(baseList);
  const next = new Set(nextList);
  const added = [...next].filter((u) => !base.has(u));
  const removed = [...base].filter((u) => !next.has(u));
  return { added, removed };
}

// Voegt een nieuwe meting toe. Draait de agent twee keer op dezelfde dag, dan
// vervangt de tweede meting de eerste in plaats van er een tweede bovenop te
// stapelen - anders zou een herhaalde run een lege diff opleveren en de echte
// wijzigingen van die dag wissen.
function applySnapshot(store, snap) {
  const s = normalize(store);
  const date = snap.date;

  const replacingToday = s.current && s.current.date === date;
  const base = replacingToday ? s.previous : s.current;

  const baseFollowers = base ? usernames(base.followers) : [];
  const baseFollowing = base ? usernames(base.following) : [];
  const nextFollowers = usernames(snap.followers);
  const nextFollowing = usernames(snap.following);

  const isFirst = !base;
  const followerDiff = isFirst ? { added: [], removed: [] } : diffUsers(baseFollowers, nextFollowers);
  const followingDiff = isFirst ? { added: [], removed: [] } : diffUsers(baseFollowing, nextFollowing);

  const events = s.events.filter((e) => e[0] !== date);
  for (const u of followerDiff.added) events.push([date, u, EVENT_FOLLOWER_GAINED]);
  for (const u of followerDiff.removed) events.push([date, u, EVENT_FOLLOWER_LOST]);
  for (const u of followingDiff.added) events.push([date, u, EVENT_FOLLOWING_ADDED]);
  for (const u of followingDiff.removed) events.push([date, u, EVENT_FOLLOWING_REMOVED]);

  const measurements = s.measurements.filter((d) => d !== date);
  measurements.push(date);
  measurements.sort();

  const next = {
    v: 2,
    current: {
      date,
      followers: snap.followers,
      following: snap.following,
      pending: snap.pending || [],
      recentRequests: snap.recentRequests || [],
      recentlyUnfollowed: snap.recentlyUnfollowed || [],
    },
    previous: base ? { date: base.date, followers: baseFollowers, following: baseFollowing } : null,
    events,
    measurements,
  };

  return {
    store: next,
    changes: {
      isFirst,
      newFollowers: followerDiff.added,
      lostFollowers: followerDiff.removed,
      newFollowing: followingDiff.added,
      unfollowedByYou: followingDiff.removed,
    },
  };
}

function lastMeasurementDate(store) {
  const s = normalize(store);
  return s.measurements.length ? s.measurements[s.measurements.length - 1] : null;
}

// Hoeveel hele dagen zitten er tussen de laatste meting en nu?
function daysSinceLastMeasurement(store, today) {
  const last = lastMeasurementDate(store);
  if (!last) return Infinity;
  const ms = Date.parse(today + 'T00:00:00Z') - Date.parse(last + 'T00:00:00Z');
  return Math.floor(ms / 86400000);
}

module.exports = {
  emptyStore,
  normalize,
  applySnapshot,
  lastMeasurementDate,
  daysSinceLastMeasurement,
  usernames,
  EVENT_FOLLOWER_GAINED,
  EVENT_FOLLOWER_LOST,
  EVENT_FOLLOWING_ADDED,
  EVENT_FOLLOWING_REMOVED,
};
