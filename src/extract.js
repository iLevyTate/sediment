/**
 * Reconstruct a repository's history from local git.
 *
 * `git log --raw` carries the post-image blob SHA of every changed file, so the
 * replay tracks *blob identity* rather than accumulating +/- numstat deltas and
 * the per-commit tree never drifts. Every blob is line-counted exactly once via
 * a batched `git cat-file --batch`.
 *
 * `--raw` shows nothing for merge commits, so content introduced by a merge
 * itself would be invisible. Periodic `git ls-tree` anchors reconcile the
 * virtual filesystem against ground truth to catch it.
 */

import { execFileSync } from "child_process";
import path from "path";
import { deriveLanes } from "./lanes.js";

const RS = "\x1e";
const US = "\x1f";
const NULL_SHA = "0000000000000000000000000000000000000000";
const BLOB_BATCH = 400;
const BINARY_SNIFF = 8000;

export const STATUS_CODES = { A: 0, M: 1, D: 2, R: 3, C: 4, T: 5 };

/** @param {string[]} args @param {string} cwd */
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
  });
}

/** Git quotes paths with control or non-ASCII bytes as C string literals. */
function unquotePath(raw) {
  if (!raw.startsWith('"')) return raw;
  const body = raw.slice(1, -1);
  const bytes = [];
  const simple = {
    n: 10,
    t: 9,
    r: 13,
    b: 8,
    f: 12,
    a: 7,
    v: 11,
    "\\": 92,
    '"': 34,
  };
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== "\\") {
      bytes.push(body.charCodeAt(i));
      continue;
    }
    const next = body[(i += 1)];
    if (Object.prototype.hasOwnProperty.call(simple, next))
      bytes.push(simple[next]);
    else {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

export const isoDay = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

function readCommits(repoRoot) {
  const format = [
    `${RS}%H`,
    "%P",
    "%an",
    "%ae",
    "%at",
    "%cn",
    "%ce",
    "%ct",
    "%s",
  ].join(US);
  const stdout = git(
    [
      "log",
      "--reverse",
      "--raw",
      "--numstat",
      "--no-abbrev",
      "-M",
      "--no-color",
      `--format=${format}`,
    ],
    repoRoot,
  );

  const commits = [];
  for (const chunk of stdout.split(RS)) {
    if (!chunk.trim()) continue;
    const nl = chunk.indexOf("\n");
    const header = nl === -1 ? chunk : chunk.slice(0, nl);
    const body = nl === -1 ? "" : chunk.slice(nl + 1);
    const [sha, parents, an, ae, at, cn, ce, ct, subject] = header.split(US);

    const rawEvents = [];
    const stats = [];
    for (const line of body.split("\n")) {
      if (!line) continue;
      if (line.startsWith(":")) {
        const tabAt = line.indexOf("\t");
        const fields = line.slice(1, tabAt).split(" ");
        const status = (fields[4] || "?")[0];
        const paths = line
          .slice(tabAt + 1)
          .split("\t")
          .map(unquotePath);
        const isMove = status === "R" || status === "C";
        rawEvents.push({
          status,
          path: isMove ? paths[1] : paths[0],
          from: isMove ? paths[0] : null,
          dstSha: fields[3],
        });
      } else {
        const [add, del] = line.split("\t");
        stats.push({
          add: add === "-" ? -1 : Number(add),
          del: del === "-" ? -1 : Number(del),
        });
      }
    }

    commits.push({
      sha,
      short: sha.slice(0, 8),
      parents: parents ? parents.split(" ") : [],
      author: { name: an, email: ae },
      authorTs: Number(at),
      commitTs: Number(ct),
      subject,
      rawEvents,
      stats,
    });
  }
  return commits;
}

function readTags(repoRoot) {
  let out = "";
  try {
    out = git(
      [
        "for-each-ref",
        "--sort=creatordate",
        `--format=%(refname:short)${US}%(objectname)${US}%(creatordate:unix)${US}%(contents:subject)`,
        "refs/tags",
      ],
      repoRoot,
    );
  } catch {
    return [];
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [tag, obj, ts, subject] = line.split(US);
      let sha = obj;
      try {
        sha = git(["rev-list", "-n", "1", tag], repoRoot).trim();
      } catch {
        /* lightweight tag: objectname is already the commit */
      }
      return { tag, sha, ts: Number(ts), subject: subject || "" };
    });
}

function readTree(sha, repoRoot) {
  const out = execFileSync("git", ["ls-tree", "-r", "-z", sha], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
  });
  const tree = new Map();
  for (const entry of out.split("\0")) {
    if (!entry) continue;
    const tabAt = entry.indexOf("\t");
    const parts = entry.slice(0, tabAt).split(/\s+/);
    if (parts[1] !== "blob") continue;
    tree.set(entry.slice(tabAt + 1), parts[2]);
  }
  return tree;
}

/** Line-count every blob once, streaming in bounded batches. */
function measureBlobs(shas, repoRoot, onProgress) {
  const unique = [...new Set(shas)].filter((s) => s && s !== NULL_SHA);
  const measured = new Map();
  for (let start = 0; start < unique.length; start += BLOB_BATCH) {
    const batch = unique.slice(start, start + BLOB_BATCH);
    const out = execFileSync("git", ["cat-file", "--batch"], {
      cwd: repoRoot,
      input: Buffer.from(`${batch.join("\n")}\n`, "utf8"),
      maxBuffer: 1024 * 1024 * 512,
    });
    let cursor = 0;
    while (cursor < out.length) {
      const headerEnd = out.indexOf(0x0a, cursor);
      if (headerEnd === -1) break;
      const header = out.toString("utf8", cursor, headerEnd).split(" ");
      if (header[1] !== "blob") {
        cursor = headerEnd + 1;
        continue;
      }
      const size = Number(header[2]);
      const bodyStart = headerEnd + 1;
      const body = out.subarray(bodyStart, bodyStart + size);
      const binary = body.subarray(0, BINARY_SNIFF).includes(0);
      let lines = 0;
      if (!binary && size > 0) {
        for (let i = 0; i < body.length; i += 1)
          if (body[i] === 0x0a) lines += 1;
        if (body[body.length - 1] !== 0x0a) lines += 1;
      }
      measured.set(header[0], { lines, bytes: size, binary });
      cursor = bodyStart + size + 1;
    }
    if (onProgress)
      onProgress(Math.min(start + BLOB_BATCH, unique.length), unique.length);
  }
  return measured;
}

/** @param {string} repoRoot */
export function repoName(repoRoot) {
  try {
    // stderr is swallowed: a repository with no remote is perfectly normal, and
    // git's complaint would otherwise land in the middle of CI output.
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {
    /* no remote */
  }
  return path.basename(path.resolve(repoRoot));
}

/**
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {number} [options.snapshotDays]
 * @param {number} [options.maxLanes]
 * @param {(msg: string) => void} [options.log]
 * @returns {object} datasets
 */
export function extract({
  repoRoot,
  snapshotDays = 7,
  maxLanes = 12,
  log = () => {},
}) {
  let shallow = false;
  try {
    shallow =
      git(["rev-parse", "--is-shallow-repository"], repoRoot).trim() === "true";
  } catch {
    throw new Error(`${repoRoot} is not a git repository`);
  }

  log("reading git log...");
  const raw = readCommits(repoRoot);
  if (raw.length === 0) throw new Error("this repository has no commits");
  const tags = readTags(repoRoot);

  const tagsBySha = new Map();
  for (const t of tags)
    tagsBySha.set(t.sha, (tagsBySha.get(t.sha) || []).concat([t.tag]));

  const stepMs = snapshotDays * 86400000;
  const anchorIndexes = new Set([0, raw.length - 1]);
  let nextAt = 0;
  raw.forEach((c, i) => {
    if (c.commitTs * 1000 >= nextAt) {
      anchorIndexes.add(i);
      nextAt = c.commitTs * 1000 + stepMs;
    }
    if (tagsBySha.has(c.sha)) anchorIndexes.add(i);
  });

  log(`reading ${anchorIndexes.size} tree anchors...`);
  const anchorTrees = new Map();
  for (const i of anchorIndexes)
    anchorTrees.set(i, readTree(raw[i].sha, repoRoot));

  const wanted = [];
  for (const c of raw) for (const ev of c.rawEvents) wanted.push(ev.dstSha);
  for (const tree of anchorTrees.values())
    for (const blob of tree.values()) wanted.push(blob);
  const blobs = measureBlobs(wanted, repoRoot, (done, total) =>
    log(`measuring blobs ${done}/${total}`, true),
  );
  const linesOf = (sha) => (sha && blobs.get(sha) ? blobs.get(sha).lines : 0);

  // Lanes come from the final tree, measured in lines so that a folder of
  // images cannot outrank the source tree.
  const finalTree = anchorTrees.get(raw.length - 1);
  const lanes = deriveLanes(
    [...finalTree.entries()].map(([p, blob]) => ({
      path: p,
      size: linesOf(blob),
    })),
    { maxLanes },
  );
  const laneOf = lanes.laneOf;

  log(`replaying ${raw.length} commits across ${lanes.keys.length} lanes...`);

  const vfs = new Map();
  let liveLoc = 0;
  let anchorCorrections = 0;
  const lifespans = new Map();
  const people = new Map();
  const days = new Map();
  const commits = [];
  const eventRows = [];
  const snapshots = [];

  const setPath = (p, sha) => {
    liveLoc -= linesOf(vfs.get(p));
    if (sha === null) vfs.delete(p);
    else {
      vfs.set(p, sha);
      liveLoc += linesOf(sha);
    }
  };

  raw.forEach((c, index) => {
    const isMerge = c.parents.length > 1;
    const ts = c.commitTs;
    const day = isoDay(ts);
    let addTotal = 0;
    let delTotal = 0;

    for (let e = 0; e < c.rawEvents.length; e += 1) {
      const ev = c.rawEvents[e];
      const stat = c.stats[e] || { add: 0, del: 0 };
      const binary = stat.add === -1 || stat.del === -1;
      const add = binary ? 0 : stat.add;
      const del = binary ? 0 : stat.del;
      addTotal += add;
      delTotal += del;

      if (ev.status === "R" && ev.from) setPath(ev.from, null);
      if (ev.status === "D") setPath(ev.path, null);
      else setPath(ev.path, ev.dstSha);

      if (
        ev.status === "R" &&
        ev.from &&
        lifespans.has(ev.from) &&
        !lifespans.has(ev.path)
      ) {
        const moved = lifespans.get(ev.from);
        lifespans.set(ev.path, {
          ...moved,
          path: ev.path,
          renamedFrom: ev.from,
        });
        lifespans.delete(ev.from);
      }
      let life = lifespans.get(ev.path);
      if (!life) {
        life = {
          path: ev.path,
          lane: laneOf(ev.path),
          bornTs: ts,
          lastTs: ts,
          diedTs: null,
          changes: 0,
          add: 0,
          del: 0,
          peakLoc: 0,
          authors: new Set(),
          renamedFrom: ev.from || null,
        };
        lifespans.set(ev.path, life);
      }
      const locAfter = linesOf(vfs.get(ev.path));
      life.changes += 1;
      life.add += add;
      life.del += del;
      life.authors.add(c.author.name);
      life.diedTs = ev.status === "D" ? ts : null;
      life.lastTs = ts;
      life.peakLoc = Math.max(life.peakLoc, locAfter);
      life.binary = binary || life.binary === true;

      eventRows.push([
        index,
        STATUS_CODES[ev.status] ?? 1,
        ev.path,
        add,
        del,
        locAfter,
        ev.from || 0,
        laneOf(ev.path),
      ]);
    }

    if (anchorTrees.has(index)) {
      const truth = anchorTrees.get(index);
      for (const [p, blob] of truth) {
        if (vfs.get(p) !== blob) {
          setPath(p, blob);
          anchorCorrections += 1;
        }
      }
      for (const p of [...vfs.keys()]) {
        if (!truth.has(p)) {
          setPath(p, null);
          anchorCorrections += 1;
        }
      }
    }

    const personKey = c.author.email.toLowerCase();
    let person = people.get(personKey);
    if (!person) {
      person = {
        name: c.author.name,
        email: c.author.email,
        bot: /\[bot\]|noreply@anthropic|cursoragent|actions@github/i.test(
          `${c.author.name} ${c.author.email}`,
        ),
        commits: 0,
        merges: 0,
        add: 0,
        del: 0,
        files: 0,
        firstTs: ts,
        lastTs: ts,
        days: new Set(),
        lanes: {},
      };
      people.set(personKey, person);
    }
    person.commits += 1;
    if (isMerge) person.merges += 1;
    person.add += addTotal;
    person.del += delTotal;
    person.files += c.rawEvents.length;
    person.lastTs = ts;
    person.days.add(day);
    for (const ev of c.rawEvents) {
      const key = lanes.labels[laneOf(ev.path)];
      person.lanes[key] = (person.lanes[key] || 0) + 1;
    }

    let bucket = days.get(day);
    if (!bucket) {
      bucket = {
        date: day,
        commits: 0,
        merges: 0,
        add: 0,
        del: 0,
        files: 0,
        authors: new Set(),
      };
      days.set(day, bucket);
    }
    bucket.commits += 1;
    if (isMerge) bucket.merges += 1;
    bucket.add += addTotal;
    bucket.del += delTotal;
    bucket.files += c.rawEvents.length;
    bucket.authors.add(c.author.name);
    bucket.loc = liveLoc;
    bucket.trackedFiles = vfs.size;

    commits.push({
      i: index,
      sha: c.sha,
      short: c.short,
      ts,
      date: day,
      authorTs: c.authorTs,
      author: c.author.name,
      email: c.author.email,
      subject: c.subject,
      merge: isMerge,
      parents: c.parents.length,
      add: addTotal,
      del: delTotal,
      files: c.rawEvents.length,
      loc: liveLoc,
      trackedFiles: vfs.size,
      tags: tagsBySha.get(c.sha) || [],
    });

    if (anchorTrees.has(index)) {
      const laneStats = lanes.keys.map(() => ({ files: 0, loc: 0 }));
      for (const [p, blob] of vfs) {
        const l = laneStats[laneOf(p)];
        l.files += 1;
        l.loc += linesOf(blob);
      }
      snapshots.push({
        commitIndex: index,
        sha: c.sha,
        ts,
        date: day,
        tags: tagsBySha.get(c.sha) || [],
        totalFiles: vfs.size,
        totalLoc: liveLoc,
        lanes: laneStats,
      });
    }
  });

  const first = commits[0];
  const last = commits[commits.length - 1];

  const daily = [...days.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => ({
      date: d.date,
      commits: d.commits,
      merges: d.merges,
      add: d.add,
      del: d.del,
      files: d.files,
      authors: [...d.authors].sort(),
      loc: d.loc,
      trackedFiles: d.trackedFiles,
    }));

  const dense = [];
  const startMs = Date.parse(`${daily[0].date}T00:00:00Z`);
  const endMs = Date.parse(`${daily[daily.length - 1].date}T00:00:00Z`);
  let carryLoc = 0;
  let carryFiles = 0;
  let cursor = 0;
  for (let t = startMs; t <= endMs; t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (cursor < daily.length && daily[cursor].date === date) {
      carryLoc = daily[cursor].loc;
      carryFiles = daily[cursor].trackedFiles;
      dense.push(daily[cursor]);
      cursor += 1;
    } else {
      dense.push({
        date,
        commits: 0,
        merges: 0,
        add: 0,
        del: 0,
        files: 0,
        authors: [],
        loc: carryLoc,
        trackedFiles: carryFiles,
      });
    }
  }

  const contributors = [...people.values()]
    .map((p) => ({
      name: p.name,
      email: p.email,
      bot: p.bot,
      commits: p.commits,
      merges: p.merges,
      add: p.add,
      del: p.del,
      fileTouches: p.files,
      firstTs: p.firstTs,
      lastTs: p.lastTs,
      firstDate: isoDay(p.firstTs),
      lastDate: isoDay(p.lastTs),
      activeDays: p.days.size,
      lanes: Object.fromEntries(
        Object.entries(p.lanes).sort((a, b) => Number(b[1]) - Number(a[1])),
      ),
    }))
    .sort((a, b) => b.commits - a.commits);

  const files = [...lifespans.values()]
    .map((f) => ({
      path: f.path,
      lane: lanes.labels[f.lane],
      bornTs: f.bornTs,
      bornDate: isoDay(f.bornTs),
      lastTs: f.lastTs,
      diedTs: f.diedTs,
      alive: vfs.has(f.path),
      loc: linesOf(vfs.get(f.path)),
      peakLoc: f.peakLoc,
      changes: f.changes,
      add: f.add,
      del: f.del,
      churn: f.add + f.del,
      authors: f.authors.size,
      binary: f.binary === true,
      renamedFrom: f.renamedFrom,
    }))
    .sort((a, b) => b.changes - a.changes);

  const punchcard = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const c of commits) {
    const d = new Date(c.ts * 1000);
    punchcard[d.getUTCDay()][d.getUTCHours()] += 1;
  }

  const releases = tags
    .map((t) => {
      const match = commits.find((c) => c.sha === t.sha);
      return {
        tag: t.tag,
        sha: t.sha,
        ts: match ? match.ts : t.ts,
        date: isoDay(match ? match.ts : t.ts),
        commitIndex: match ? match.i : null,
        subject: t.subject || (match ? match.subject : ""),
        loc: match ? match.loc : null,
        trackedFiles: match ? match.trackedFiles : null,
      };
    })
    .filter((r) => r.commitIndex !== null);

  const meta = {
    schemaVersion: 2,
    repo: repoName(repoRoot),
    source: "git",
    units: "lines",
    generatedAt: new Date().toISOString(),
    shallow,
    snapshotDays,
    commits: commits.length,
    merges: commits.filter((c) => c.merge).length,
    fileEvents: eventRows.length,
    contributors: contributors.length,
    filesEverSeen: files.length,
    filesAlive: files.filter((f) => f.alive).length,
    totalAdditions: commits.reduce((s, c) => s + c.add, 0),
    totalDeletions: commits.reduce((s, c) => s + c.del, 0),
    finalLoc: last.loc,
    anchors: anchorTrees.size,
    anchorCorrections,
    range: {
      firstSha: first.sha,
      firstDate: first.date,
      firstTs: first.ts,
      lastSha: last.sha,
      lastDate: last.date,
      lastTs: last.ts,
      spanDays: Math.max(1, Math.round((last.ts - first.ts) / 86400)),
    },
    statusCodes: STATUS_CODES,
    lanes: lanes.labels,
  };

  return {
    meta,
    commits,
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
      statusCodes: STATUS_CODES,
      rows: eventRows,
    },
    daily: dense,
    snapshots,
    contributors,
    releases,
    files,
    lanes: { keys: lanes.keys, labels: lanes.labels },
    derived: {
      hotspots: files.slice(0, 200).map((f) => ({
        path: f.path,
        lane: f.lane,
        changes: f.changes,
        churn: f.churn,
        loc: f.loc,
        alive: f.alive,
      })),
      largest: [...files]
        .filter((f) => f.alive)
        .sort((a, b) => b.loc - a.loc)
        .slice(0, 200)
        .map((f) => ({
          path: f.path,
          lane: f.lane,
          loc: f.loc,
          changes: f.changes,
        })),
      punchcard: {
        rows: "UTC day-of-week, 0=Sunday",
        cols: "UTC hour",
        counts: punchcard,
      },
      busiestDays: [...dense]
        .sort((a, b) => b.commits - a.commits)
        .slice(0, 25)
        .map((d) => ({
          date: d.date,
          commits: d.commits,
          add: d.add,
          del: d.del,
        })),
    },
  };
}
