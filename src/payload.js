/**
 * Compact the datasets into the payload the player consumes.
 *
 * Pure — no filesystem, no node built-ins — because both producers use it: the
 * CLI (from local git, measuring lines) and the web build (from the GitHub API,
 * measuring bytes). Whatever the source, the player receives one shape.
 */

import { lanePalette } from "./palette.js";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Axis ticks, coarsened with the span so a decade of history does not print a
 * hundred month labels.
 * @param {number} t0 @param {number} t1 epoch seconds
 * @returns {Array<[number, string]>}
 */
export function timeTicks(t0, t1) {
  const days = (t1 - t0) / 86400;
  const stepMonths = days > 2900 ? 12 : days > 1100 ? 6 : days > 500 ? 3 : 1;
  const ticks = [];
  const cursor = new Date(t0 * 1000);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() / 1000 < t1) {
    const m = cursor.getUTCMonth();
    if (m % stepMonths === 0) {
      const yy = String(cursor.getUTCFullYear()).slice(2);
      ticks.push([
        Math.round(cursor.getTime() / 1000),
        stepMonths === 12
          ? String(cursor.getUTCFullYear())
          : `${MONTHS[m]} '${yy}`,
      ]);
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return ticks;
}

/**
 * @param {object} data normalized datasets — see README "Payload contract"
 * @returns {object} payload
 */
export function buildPayload(data) {
  const {
    meta,
    lanes,
    commits,
    snapshots,
    releases,
    contributors,
    fileEvents,
  } = data;

  const authors = [];
  const authorIndex = new Map();
  for (const c of contributors) {
    authorIndex.set(c.email.toLowerCase(), authors.length);
    authors.push([c.name, c.bot ? 1 : 0]);
  }

  const paths = [];
  const pathIndex = new Map();
  const pathId = (p) => {
    let id = pathIndex.get(p);
    if (id === undefined) {
      id = paths.length;
      paths.push(p);
      pathIndex.set(p, id);
    }
    return id;
  };

  const laneCount = lanes.keys.length;
  const colors = lanePalette(laneCount);

  let events = [];
  if (fileEvents && fileEvents.rows.length) {
    const col = (name) => fileEvents.columns.indexOf(name);
    const cCommit = col("commit");
    const cStatus = col("status");
    const cPath = col("path");
    const cLoc = col("locAfter");
    const cLane = col("lane"); // both producers resolve the lane up front
    events = fileEvents.rows.map((row) => [
      row[cCommit],
      row[cStatus],
      row[cLane],
      row[cLoc],
      pathId(row[cPath]),
    ]);
  }

  const t0 = meta.range.firstTs;
  const t1 = meta.range.lastTs;

  const laneSeries = snapshots.map((s) => [
    s.ts,
    Array.from({ length: laneCount }, (_, i) =>
      s.lanes[i] ? s.lanes[i].loc : 0,
    ),
  ]);

  let maxLaneLoc = 1;
  for (const [, locs] of laneSeries)
    for (const v of locs) if (v > maxLaneLoc) maxLaneLoc = v;

  // The wordmark is set two-tone; for `owner/name` the owner is the quiet half.
  const slash = meta.repo.lastIndexOf("/");
  const titleParts =
    slash === -1
      ? ["", meta.repo]
      : [`${meta.repo.slice(0, slash)}/`, meta.repo.slice(slash + 1)];

  return {
    title: meta.repo,
    titleParts,
    units: meta.units || "lines",
    source: meta.source || "git",
    meta: {
      commits: meta.commits,
      merges: meta.merges,
      fileEvents: meta.fileEvents,
      contributors: meta.contributors,
      filesEverSeen: meta.filesEverSeen,
      filesAlive: meta.filesAlive,
      finalLoc: meta.finalLoc,
      spanDays: meta.range.spanDays,
      note: meta.note || "",
    },
    range: [t0, t1],
    maxLoc: Math.max(1, ...snapshots.map((s) => s.totalLoc)),
    maxLaneLoc,
    lanes: lanes.keys.map((k, i) => `l${i}`),
    laneLabels: lanes.labels,
    colors,
    authors,
    paths,
    ticks: timeTicks(t0, t1),
    commits: commits.map((c) => [
      c.ts,
      authorIndex.get(c.email.toLowerCase()) ?? 0,
      c.add,
      c.del,
      c.loc,
      c.trackedFiles,
      c.merge ? 1 : 0,
      c.short,
      c.subject,
    ]),
    snapshots: laneSeries,
    releases: releases.map((r) => [r.ts, r.tag]),
    events,
  };
}

/**
 * Inline a payload into the player template, producing a standalone page.
 * Used by the CLI to write a file and by the web build to offer a download —
 * one code path, so an exported page is byte-identical to a generated one.
 * @param {string} template @param {object} payload @returns {string}
 */
export function buildHtml(template, payload) {
  const MARKER = "/*__PAYLOAD__*/ null";
  if (!template.includes(MARKER))
    throw new Error("player template is missing the payload marker");
  const json = JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return template.replace(MARKER, json);
}
