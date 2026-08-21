/**
 * Build the same datasets from the GitHub REST API, for the hosted version
 * where there is no clone to read.
 *
 * The API cannot give per-commit file lists cheaply — that is one request per
 * commit — so this takes a different route to the same shape:
 *
 *   • the commit list comes from /commits (100 per request);
 *   • the tree at a set of anchor commits comes from /git/trees?recursive=1,
 *     one request each, carrying every path and its size in bytes;
 *   • file events are recovered by *diffing consecutive anchor trees*, which
 *     costs nothing extra and is real data — those files genuinely changed in
 *     that window, just attributed to the window rather than the exact commit.
 *
 * The trade against the CLI: sizes are bytes rather than lines (binaries score
 * zero), and events land at anchor granularity. Both are stated on the page.
 */

import { deriveLanes, isBinaryPath } from "./lanes.js";

const API = "https://api.github.com";
export const STATUS = { A: 0, M: 1, D: 2 };

/** @param {string} input owner/repo, or any github URL containing it */
export function parseRepo(input) {
  const cleaned = String(input || "")
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "");
  const m = cleaned.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

const isoDay = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

/**
 * @param {object} o
 * @param {string} o.owner @param {string} o.repo
 * @param {string} [o.token] a PAT lifts the rate limit from 60/hr to 5000/hr
 * @param {number} [o.maxCommits] stop after this many (newest first)
 * @param {number} [o.anchors] tree snapshots to take
 * @param {number} [o.maxLanes]
 * @param {(msg: string, pct?: number) => void} [o.onProgress]
 * @param {typeof fetch} [o.fetchImpl] injected for testing
 */
export async function fetchHistory({
  owner,
  repo,
  token = "",
  maxCommits = 4000,
  anchors = 26,
  maxLanes = 12,
  onProgress = () => {},
  fetchImpl = fetch,
}) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let rateRemaining = null;

  async function api(pathname) {
    const res = await fetchImpl(`${API}${pathname}`, { headers });
    const remaining =
      res.headers &&
      res.headers.get &&
      res.headers.get("x-ratelimit-remaining");
    if (remaining !== null && remaining !== undefined)
      rateRemaining = Number(remaining);
    if (res.status === 404)
      throw new Error(`${owner}/${repo} not found, or it is private`);
    if (res.status === 403 || res.status === 429) {
      throw new Error(
        rateRemaining === 0
          ? "GitHub rate limit reached. Add a personal access token, or wait for the reset."
          : `GitHub refused the request (${res.status}).`,
      );
    }
    if (!res.ok)
      throw new Error(`GitHub returned ${res.status} for ${pathname}`);
    return {
      body: await res.json(),
      link: (res.headers.get && res.headers.get("link")) || "",
    };
  }

  onProgress("reading repository");
  const { body: info } = await api(`/repos/${owner}/${repo}`);
  const branch = info.default_branch;

  // --- commits -------------------------------------------------------------
  onProgress("reading commits");
  const PER = 100;
  const first = await api(
    `/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${PER}`,
  );
  if (!first.body.length) throw new Error("this repository has no commits");

  // The Link header tells us the page count up front, but only when CORS
  // exposes it — so it drives the progress bar, never the loop. Paging stops on
  // a short page, which is true regardless of what headers arrive.
  const lastPage = Number(
    (first.link.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/) || [])[1] || 0,
  );
  const pageCap = Math.max(1, Math.ceil(maxCommits / PER));
  let rows = first.body.slice();
  let page = 1;
  let batch = first.body.length;
  while (batch === PER && page < pageCap) {
    page += 1;
    const of = lastPage ? `/${Math.min(lastPage, pageCap)}` : "";
    onProgress(
      `reading commits — page ${page}${of}`,
      lastPage ? page / Math.min(lastPage, pageCap) : 0.5,
    );
    const next = await api(
      `/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${PER}&page=${page}`,
    );
    batch = next.body.length;
    rows = rows.concat(next.body);
  }

  // We stopped early only if the final page came back full.
  const truncated = batch === PER && page >= pageCap;
  // The API returns newest first; the film runs forwards.
  const commitsRaw = rows
    .map((c) => ({
      sha: c.sha,
      short: c.sha.slice(0, 8),
      ts: Math.floor(Date.parse(c.commit.committer.date) / 1000),
      authorTs: Math.floor(Date.parse(c.commit.author.date) / 1000),
      name: c.commit.author.name || (c.author && c.author.login) || "unknown",
      email: (
        c.commit.author.email ||
        (c.author && c.author.login) ||
        "unknown"
      ).toLowerCase(),
      subject: String(c.commit.message).split("\n")[0],
      parents: c.parents ? c.parents.length : 1,
    }))
    .sort((a, b) => a.ts - b.ts);

  // --- tags ----------------------------------------------------------------
  let tags = [];
  try {
    const { body } = await api(`/repos/${owner}/${repo}/tags?per_page=100`);
    tags = body.map((t) => ({ tag: t.name, sha: t.commit.sha }));
  } catch {
    /* tags are optional */
  }

  // --- anchor trees --------------------------------------------------------
  const anchorCount = Math.max(2, Math.min(anchors, commitsRaw.length));
  const anchorIdx = [];
  for (let i = 0; i < anchorCount; i += 1) {
    anchorIdx.push(
      Math.round((i * (commitsRaw.length - 1)) / (anchorCount - 1)),
    );
  }
  const uniqueAnchors = [...new Set(anchorIdx)];

  const trees = [];
  for (let i = 0; i < uniqueAnchors.length; i += 1) {
    const idx = uniqueAnchors[i];
    onProgress(
      `reading tree ${i + 1}/${uniqueAnchors.length}`,
      i / uniqueAnchors.length,
    );
    const { body } = await api(
      `/repos/${owner}/${repo}/git/trees/${commitsRaw[idx].sha}?recursive=1`,
    );
    const map = new Map();
    for (const e of body.tree || []) {
      if (e.type !== "blob") continue;
      map.set(e.path, {
        sha: e.sha,
        size: isBinaryPath(e.path) ? 0 : e.size || 0,
      });
    }
    trees.push({
      index: idx,
      ts: commitsRaw[idx].ts,
      sha: commitsRaw[idx].sha,
      map,
      truncated: !!body.truncated,
    });
  }

  const finalTree = trees[trees.length - 1];
  const lanes = deriveLanes(
    [...finalTree.map.entries()].map(([p, v]) => ({ path: p, size: v.size })),
    { maxLanes },
  );

  // --- events by diffing consecutive trees ---------------------------------
  const eventRows = [];
  for (let i = 1; i < trees.length; i += 1) {
    const prev = trees[i - 1];
    const cur = trees[i];
    const windowStart = prev.index + 1;
    const windowLen = Math.max(1, cur.index - prev.index);
    let n = 0;
    const place = () => windowStart + (n++ % windowLen);

    for (const [p, v] of cur.map) {
      const before = prev.map.get(p);
      if (!before)
        eventRows.push([
          place(),
          STATUS.A,
          p,
          0,
          0,
          v.size,
          0,
          lanes.laneOf(p),
        ]);
      else if (before.sha !== v.sha)
        eventRows.push([
          place(),
          STATUS.M,
          p,
          0,
          0,
          v.size,
          0,
          lanes.laneOf(p),
        ]);
    }
    for (const p of prev.map.keys()) {
      if (!cur.map.has(p))
        eventRows.push([place(), STATUS.D, p, 0, 0, 0, 0, lanes.laneOf(p)]);
    }
  }
  eventRows.sort((a, b) => a[0] - b[0]);

  // --- per-commit running totals, interpolated between anchors -------------
  // Summed once per tree rather than once per commit: the naive version is
  // commits x files, which is millions of additions on a large repository.
  const treeSum = trees.map((t) => {
    let bytes = 0;
    for (const v of t.map.values()) bytes += v.size;
    return { bytes, files: t.map.size };
  });

  const sizeAt = (index) => {
    // A repository with a single anchor (one commit, or every anchor landing on
    // the same commit) has nothing to interpolate between.
    if (trees.length < 2)
      return { loc: treeSum[0].bytes, files: treeSum[0].files };
    let hi = 1;
    while (hi < trees.length - 1 && trees[hi].index < index) hi += 1;
    const a = trees[hi - 1];
    const b = trees[hi];
    const f =
      b.index === a.index
        ? 0
        : Math.max(0, Math.min(1, (index - a.index) / (b.index - a.index)));
    return {
      loc: Math.round(
        treeSum[hi - 1].bytes + (treeSum[hi].bytes - treeSum[hi - 1].bytes) * f,
      ),
      files: Math.round(
        treeSum[hi - 1].files + (treeSum[hi].files - treeSum[hi - 1].files) * f,
      ),
    };
  };

  const tagsBySha = new Map();
  for (const t of tags)
    tagsBySha.set(t.sha, (tagsBySha.get(t.sha) || []).concat([t.tag]));

  const people = new Map();
  const commits = commitsRaw.map((c, i) => {
    const at = sizeAt(i);
    let person = people.get(c.email);
    if (!person) {
      person = {
        name: c.name,
        email: c.email,
        bot: /\[bot\]|noreply@anthropic|cursoragent|actions@github/i.test(
          `${c.name} ${c.email}`,
        ),
        commits: 0,
        merges: 0,
        add: 0,
        del: 0,
        fileTouches: 0,
        firstTs: c.ts,
        lastTs: c.ts,
        days: new Set(),
        lanes: {},
      };
      people.set(c.email, person);
    }
    person.commits += 1;
    if (c.parents > 1) person.merges += 1;
    person.lastTs = c.ts;
    person.days.add(isoDay(c.ts));
    return {
      i,
      sha: c.sha,
      short: c.short,
      ts: c.ts,
      date: isoDay(c.ts),
      authorTs: c.authorTs,
      author: c.name,
      email: c.email,
      subject: c.subject,
      merge: c.parents > 1,
      parents: c.parents,
      add: 0,
      del: 0,
      files: 0,
      loc: at.loc,
      trackedFiles: at.files,
      tags: tagsBySha.get(c.sha) || [],
    };
  });

  const snapshots = trees.map((t) => {
    const laneStats = lanes.keys.map(() => ({ files: 0, loc: 0 }));
    let total = 0;
    for (const [p, v] of t.map) {
      const l = laneStats[lanes.laneOf(p)];
      l.files += 1;
      l.loc += v.size;
      total += v.size;
    }
    return {
      commitIndex: t.index,
      sha: t.sha,
      ts: t.ts,
      date: isoDay(t.ts),
      totalFiles: t.map.size,
      totalLoc: total,
      lanes: laneStats,
    };
  });

  const contributors = [...people.values()]
    .map((p) => ({
      ...p,
      activeDays: p.days.size,
      days: undefined,
      firstDate: isoDay(p.firstTs),
      lastDate: isoDay(p.lastTs),
    }))
    .sort((a, b) => b.commits - a.commits);

  const byIndex = new Map(commits.map((c) => [c.sha, c.i]));
  const releases = tags
    .filter((t) => byIndex.has(t.sha))
    .map((t) => ({
      tag: t.tag,
      sha: t.sha,
      ts: commits[byIndex.get(t.sha)].ts,
      commitIndex: byIndex.get(t.sha),
    }))
    .sort((a, b) => a.ts - b.ts);

  const last = commits[commits.length - 1];
  const notes = [
    `Built from the GitHub API: sizes are file bytes, binaries counted as zero`,
  ];
  if (eventRows.length)
    notes.push(
      `file events recovered by diffing ${trees.length} tree snapshots`,
    );
  if (truncated)
    notes.push(`showing the most recent ${commits.length} commits`);
  if (finalTree.truncated)
    notes.push("the tree listing was truncated by GitHub");

  return {
    rateRemaining,
    truncated,
    datasets: {
      meta: {
        schemaVersion: 2,
        repo: `${owner}/${repo}`,
        source: "github",
        units: "bytes",
        note: `${notes.join("; ")}.`,
        generatedAt: new Date().toISOString(),
        commits: commits.length,
        merges: commits.filter((c) => c.merge).length,
        fileEvents: eventRows.length,
        contributors: contributors.length,
        filesEverSeen: last.trackedFiles,
        filesAlive: last.trackedFiles,
        finalLoc: last.loc,
        range: {
          firstSha: commits[0].sha,
          firstDate: commits[0].date,
          firstTs: commits[0].ts,
          lastSha: last.sha,
          lastDate: last.date,
          lastTs: last.ts,
          spanDays: Math.max(1, Math.round((last.ts - commits[0].ts) / 86400)),
        },
      },
      lanes: { keys: lanes.keys, labels: lanes.labels },
      commits,
      snapshots,
      releases,
      contributors,
      fileEvents: {
        columns: [
          "commit",
          "status",
          "path",
          "add",
          "del",
          "locAfter",
          "renamedFrom",
          "lane",
        ],
        rows: eventRows,
      },
    },
  };
}
