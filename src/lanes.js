/**
 * Lane derivation.
 *
 * A lane is a region of the tree that gets its own band in the section. Rather
 * than asking every user to describe their layout, lanes are derived from the
 * repository's own shape: group by top-level directory, split any group that is
 * large enough to hide structure, keep the biggest handful, and sweep the tail
 * into `other`.
 *
 * The result is a set of path *prefixes*, so a file that existed only in the
 * distant past — and is therefore absent from the tree the lanes were derived
 * from — still lands in a lane by longest-prefix match.
 */

const ROOT = '';
const OTHER = ' other'; // leading space cannot collide with a real prefix

/** @param {string} path @param {number} depth */
function prefixAt(path, depth) {
  const parts = path.split('/');
  if (parts.length <= 1) return ROOT;
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
}

/** @param {string} prefix */
function labelFor(prefix) {
  if (prefix === ROOT) return '(root)';
  if (prefix === OTHER) return 'other';
  return prefix;
}

/**
 * @param {Array<{path: string, size: number}>} entries files in the final tree
 * @param {{maxLanes?: number, splitShare?: number, minShare?: number}} [options]
 *   maxLanes   hard cap on bands, tail merged into `other` (default 12)
 *   splitShare a top-level group holding at least this share of the repo is
 *              split one level deeper, so a monolithic `src/` still shows its
 *              internal structure (default 0.18)
 *   minShare   a lane below this share is folded into `other` (default 0.004)
 * @returns {{keys: string[], labels: string[], laneOf: (path: string) => number}}
 */
export function deriveLanes(entries, options = {}) {
  const { maxLanes = 12, splitShare = 0.18, minShare = 0.004 } = options;

  const total = entries.reduce((sum, e) => sum + e.size, 0) || 1;

  /** @type {Map<string, number>} */
  const level1 = new Map();
  for (const e of entries) {
    const k = prefixAt(e.path, 1);
    level1.set(k, (level1.get(k) || 0) + e.size);
  }

  // Split the groups big enough to be hiding something, but only where the
  // split actually reveals more than one child.
  /** @type {Map<string, number>} */
  const sized = new Map();
  for (const [key, size] of level1) {
    if (key === ROOT || size / total < splitShare) {
      sized.set(key, size);
      continue;
    }
    /** @type {Map<string, number>} */
    const children = new Map();
    for (const e of entries) {
      if (prefixAt(e.path, 1) !== key) continue;
      const c = prefixAt(e.path, 2);
      children.set(c, (children.get(c) || 0) + e.size);
    }
    if (children.size > 1) for (const [c, s] of children) sized.set(c, s);
    else sized.set(key, size);
  }

  const ranked = [...sized.entries()]
    .filter((pair) => pair[1] / total >= minShare)
    .sort((a, b) => b[1] - a[1]);

  const kept = ranked.slice(0, Math.max(1, maxLanes - 1)).map((pair) => pair[0]);
  const keptSet = new Set(kept);
  const hasOther = sized.size > kept.length;

  // Bands stack biggest-at-the-bottom; `other` sits on top.
  const keys = hasOther ? kept.concat([OTHER]) : kept.slice();

  /** @type {Map<string, number>} */
  const index = new Map(keys.map((k, i) => [k, i]));
  const otherIndex = hasOther ? index.get(OTHER) : keys.length - 1;

  /** @param {string} path */
  function laneOf(path) {
    const two = prefixAt(path, 2);
    if (keptSet.has(two)) return index.get(two);
    const one = prefixAt(path, 1);
    if (keptSet.has(one)) return index.get(one);
    return otherIndex;
  }

  return { keys, labels: keys.map(labelFor), laneOf };
}

/**
 * Extensions whose byte size says nothing about how much was written. The CLI
 * measures lines and scores these at zero naturally; the web build only has
 * byte sizes from the tree API, so it needs the list to stop an icon folder
 * from outranking the source tree.
 */
const BINARY_EXT = new Set(
  (
    'png jpg jpeg gif webp bmp ico icns tiff avif pdf zip gz tgz bz2 xz 7z rar ' +
    'mp3 mp4 mov avi mkv webm wav ogg flac ttf otf woff woff2 eot exe dll so ' +
    'dylib node wasm bin dat psd ai sketch fig jar class pyc pyo o a lib ' +
    'sqlite db mo pack idx'
  ).split(' ')
);

/** @param {string} path */
export function isBinaryPath(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return BINARY_EXT.has(path.slice(dot + 1).toLowerCase());
}

export { ROOT, OTHER, labelFor };
