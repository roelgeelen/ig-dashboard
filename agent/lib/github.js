// Schrijft versleutelde bestanden naar de repo via de GitHub Contents API.
// Dat is bewust geen "git push": de GitHub Action commit dagelijks zelf in
// dezelfde repo, en een API-write per bestand kan niet botsen met een lokale
// werkkopie die achterloopt.

const OWNER = 'roelgeelen';
const REPO = 'ig-dashboard';
const BRANCH = 'main';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function getFile(token, path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;
  const res = await fetch(url, { headers: headers(token) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub lezen mislukt (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  return { sha: json.sha, text: Buffer.from(json.content, 'base64').toString('utf8') };
}

async function putFile(token, path, text, message) {
  const existing = await getFile(token, path);
  const body = {
    message,
    content: Buffer.from(text, 'utf8').toString('base64'),
    branch: BRANCH,
  };
  if (existing) body.sha = existing.sha;

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GitHub schrijven mislukt (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

module.exports = { getFile, putFile, OWNER, REPO, BRANCH };
