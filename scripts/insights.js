// Haalt account-insights (bereik, profielweergaven, interacties) en de best
// presterende berichten op via de Instagram Graph API.
//
// Bewust defensief: elke metric en elke post wordt apart geprobeerd en een fout
// levert simpelweg "geen waarde" op in plaats van een exception. Zo kan een token
// zonder de insights-rechten (instagram_business_manage_insights) nooit de
// dagelijkse volgersmeting laten falen — de insights blijven dan gewoon leeg tot
// het token opnieuw met die rechten wordt aangemaakt.
//
// De Graph API is per versie wisselend over welke parameters een metric wil
// (sommige eisen metric_type=total_value, andere weigeren het juist). Daarom
// proberen we per metric een paar varianten en lezen we zowel het total_value-
// als het time_series-antwoordformaat uit.

const API_ROOT = 'https://graph.instagram.com/v22.0';

// Account-metrics die we dagelijks proberen. Wat lukt wordt bewaard, de rest
// stilzwijgend overgeslagen.
const ACCOUNT_METRICS = [
  'reach', 'profile_views', 'accounts_engaged', 'total_interactions',
  'likes', 'comments', 'saves', 'shares', 'replies', 'views',
];

// Per-post metrics. Reels en foto's ondersteunen deels andere metrics; daarom
// per stuk proberen in plaats van in één call (één ongeldige metric laat anders
// de hele call falen).
const POST_METRICS = ['reach', 'saved', 'total_interactions', 'shares'];

function pickValue(json) {
  if (!json || json.error || !Array.isArray(json.data) || !json.data.length) return null;
  const d = json.data[0];
  if (d.total_value && typeof d.total_value.value === 'number') return d.total_value.value;
  if (Array.isArray(d.values) && d.values.length) {
    const v = d.values[d.values.length - 1].value;
    return typeof v === 'number' ? v : null;
  }
  return null;
}

async function tryGet(url, fetchImpl) {
  try {
    const res = await fetchImpl(url);
    return await res.json();
  } catch (e) {
    return { error: { message: String(e && e.message || e) } };
  }
}

async function fetchAccountMetric(igId, token, metric, fetchImpl) {
  const enc = encodeURIComponent(token);
  const variants = [
    `${API_ROOT}/${igId}/insights?metric=${metric}&metric_type=total_value&period=day&access_token=${enc}`,
    `${API_ROOT}/${igId}/insights?metric=${metric}&period=day&access_token=${enc}`,
  ];
  for (const url of variants) {
    const j = await tryGet(url, fetchImpl);
    if (j && !j.error) {
      const v = pickValue(j);
      if (v != null) return v;
    }
  }
  return null;
}

async function fetchAccountInsights(igId, token, { fetchImpl = fetch } = {}) {
  const out = {};
  for (const m of ACCOUNT_METRICS) {
    const v = await fetchAccountMetric(igId, token, m, fetchImpl);
    if (v != null) out[m] = v;
  }
  return out;
}

async function fetchPostMetric(mediaId, token, metric, fetchImpl) {
  const enc = encodeURIComponent(token);
  const j = await tryGet(`${API_ROOT}/${mediaId}/insights?metric=${metric}&access_token=${enc}`, fetchImpl);
  if (j && !j.error) return pickValue(j);
  return null;
}

// Haalt de recente berichten op, rangschikt op zichtbare betrokkenheid (likes +
// reacties) en verrijkt alleen de bovenste `detail` stuks met bereik/opgeslagen —
// dat scheelt een hoop API-calls per dag.
async function fetchTopPosts(igId, token, { fetchImpl = fetch, limit = 24, detail = 10 } = {}) {
  const enc = encodeURIComponent(token);
  const fields = 'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count';
  const j = await tryGet(`${API_ROOT}/${igId}/media?fields=${fields}&limit=${limit}&access_token=${enc}`, fetchImpl);
  if (!j || j.error || !Array.isArray(j.data)) return [];

  const posts = j.data.map((m) => ({
    id: m.id,
    caption: (m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    media_type: m.media_type || null,
    media_product_type: m.media_product_type || null,
    permalink: m.permalink || null,
    timestamp: m.timestamp || null,
    thumbnail_url: m.thumbnail_url || m.media_url || null,
    like_count: typeof m.like_count === 'number' ? m.like_count : null,
    comments_count: typeof m.comments_count === 'number' ? m.comments_count : null,
  }));

  const score = (p) => (p.like_count || 0) + (p.comments_count || 0);
  const ranked = posts.slice().sort((a, b) => score(b) - score(a));
  const topIds = new Set(ranked.slice(0, detail).map((p) => p.id));

  for (const p of posts) {
    if (!topIds.has(p.id)) continue;
    for (const metric of POST_METRICS) {
      const v = await fetchPostMetric(p.id, token, metric, fetchImpl);
      if (v != null) p[metric] = v;
    }
  }
  return posts;
}

module.exports = {
  fetchAccountInsights,
  fetchTopPosts,
  pickValue,
  ACCOUNT_METRICS,
  POST_METRICS,
  API_ROOT,
};
