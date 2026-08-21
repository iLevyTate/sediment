/**
 * Exercise the GitHub code path without the network.
 *
 * Fixtures are generated from a real local repository and shaped exactly like
 * GitHub's responses (including the Link header that drives pagination), then
 * injected as `fetchImpl`. That covers everything except the HTTP itself.
 */
import { execFileSync } from 'child_process';
import { fetchHistory, parseRepo } from '../src/github.js';
import { buildPayload, buildHtml } from '../src/payload.js';
import fs from 'fs';
import path from 'path';

const REPO = process.argv[2] || '/home/user/StratoSortCore';
const US = '\x1f';

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1e9 });

// --- build fixtures ---------------------------------------------------------
const log = git(['log', '--reverse', `--format=%H${US}%P${US}%an${US}%ae${US}%aI${US}%cI${US}%s`])
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [sha, parents, an, ae, aI, cI, subject] = l.split(US);
    return {
      sha,
      commit: {
        author: { name: an, email: ae, date: aI },
        committer: { date: cI },
        message: subject,
      },
      author: { login: an.replace(/\s+/g, '') },
      parents: (parents ? parents.split(' ') : []).map((p) => ({ sha: p })),
    };
  });
const newestFirst = log.slice().reverse();
const PER = 100;
const pages = Math.ceil(newestFirst.length / PER);

function treeFor(sha) {
  const out = execFileSync('git', ['ls-tree', '-r', '-l', '-z', sha], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 1e9,
  });
  const tree = [];
  for (const entry of out.split('\0')) {
    if (!entry) continue;
    const tab = entry.indexOf('\t');
    const parts = entry.slice(0, tab).split(/\s+/);
    if (parts[1] !== 'blob') continue;
    tree.push({
      path: entry.slice(tab + 1),
      type: 'blob',
      sha: parts[2],
      size: Number(parts[3]) || 0,
    });
  }
  return { tree, truncated: false };
}

let calls = 0;
const fetchImpl = async (url) => {
  calls += 1;
  const u = new URL(url);
  const headers = new Map([['x-ratelimit-remaining', String(5000 - calls)]]);
  const res = (body, link = '') => ({
    ok: true,
    status: 200,
    headers: {
      get: (k) => (k.toLowerCase() === 'link' ? link : (headers.get(k.toLowerCase()) ?? null)),
    },
    json: async () => body,
  });

  if (/\/repos\/[^/]+\/[^/]+$/.test(u.pathname)) return res({ default_branch: 'main' });
  if (u.pathname.endsWith('/commits')) {
    const page = Number(u.searchParams.get('page') || 1);
    const link = pages > 1 ? `<https://api.github.com/x?page=${pages}>; rel="last"` : '';
    return res(newestFirst.slice((page - 1) * PER, page * PER), link);
  }
  if (u.pathname.endsWith('/tags')) {
    const tags = git(['tag'])
      .split('\n')
      .filter(Boolean)
      .slice(0, 100)
      .map((t) => ({ name: t, commit: { sha: git(['rev-list', '-n', '1', t]).trim() } }));
    return res(tags);
  }
  const m = u.pathname.match(/\/git\/trees\/([0-9a-f]+)$/);
  if (m) return res(treeFor(m[1]));
  throw new Error(`unexpected request ${u.pathname}`);
};

// --- run --------------------------------------------------------------------
const { owner, repo } = parseRepo('iLevyTate/StratoSortCore');
const t0 = Date.now();
const { datasets, rateRemaining } = await fetchHistory({
  owner,
  repo,
  fetchImpl,
  anchors: 26,
  onProgress: (m) => process.stderr.write(`\r\x1b[K  ${m}`),
});
process.stderr.write('\n');

const payload = buildPayload(datasets);
const html = buildHtml(
  fs.readFileSync(new URL('../src/player.html', import.meta.url), 'utf8'),
  payload
);
const out = process.argv[3] || '/tmp/sed-web/index.html';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);

const m = datasets.meta;
console.log(`requests: ${calls}  (rate remaining reported: ${rateRemaining})`);
console.log(`commits: ${m.commits}  contributors: ${m.contributors}  events: ${m.fileEvents}`);
console.log(
  `files: ${m.filesAlive}  bytes: ${m.finalLoc}  span: ${m.range.firstDate}..${m.range.lastDate}`
);
console.log(`lanes: ${datasets.lanes.labels.join(', ')}`);
console.log(`releases: ${datasets.releases.length}`);
console.log(`note: ${m.note}`);
console.log(
  `wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB) in ${Date.now() - t0}ms`
);
