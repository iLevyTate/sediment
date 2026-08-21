#!/usr/bin/env node
/**
 * sediment — turn a git repository's history into a stratigraphic film.
 *
 *   npx sediment                     # build .sediment/index.html from the repo here
 *   npx sediment --video             # ...and record it to .sediment/sediment.mp4
 *   npx sediment --repo ../other     # somewhere else
 *   npx sediment web-assets          # assemble _site/ for GitHub Pages
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extract, repoName } from '../src/extract.js';
import { buildPayload, buildHtml } from '../src/payload.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TEMPLATE = path.join(ROOT, 'src', 'player.html');

const USAGE = `sediment — turn a git repository's history into a stratigraphic film

  sediment [options]              build the interactive page (and optionally a video)
  sediment web-assets [--out DIR] assemble the GitHub Pages site into DIR (default _site)

Options
  --repo PATH        repository to read (default: current directory)
  --out DIR          output directory (default: .sediment)
  --video            also record an mp4 (needs playwright + ffmpeg)
  --gif              also write a gif alongside the mp4
  --seconds N        deposition length in the video (default 30)
  --fps N            frames per second (default 30)
  --width N          video width (default 1920)
  --height N         video height (default 1080)
  --theme dark|light video theme (default dark)
  --hold N           seconds to hold on the closing card (default 3)
  --lanes N          maximum bands in the section (default 12)
  --snapshot-days N  days between tree snapshots (default 7)
  --json             also write the full datasets as JSON
  -h, --help         this
`;

function parseArgs(argv) {
  const o = {
    command: 'build',
    repo: process.cwd(),
    out: '.sediment',
    video: false,
    gif: false,
    seconds: 30,
    fps: 30,
    width: 1920,
    height: 1080,
    theme: 'dark',
    hold: 3,
    lanes: 12,
    snapshotDays: 7,
    json: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--repo') o.repo = argv[(i += 1)];
    else if (a === '--out') o.out = argv[(i += 1)];
    else if (a === '--video') o.video = true;
    else if (a === '--gif') {
      o.gif = true;
      o.video = true;
    } else if (a === '--seconds') o.seconds = Number(argv[(i += 1)]);
    else if (a === '--fps') o.fps = Number(argv[(i += 1)]);
    else if (a === '--width') o.width = Number(argv[(i += 1)]);
    else if (a === '--height') o.height = Number(argv[(i += 1)]);
    else if (a === '--theme') o.theme = argv[(i += 1)];
    else if (a === '--hold') o.hold = Number(argv[(i += 1)]);
    else if (a === '--lanes') o.lanes = Number(argv[(i += 1)]);
    else if (a === '--snapshot-days') o.snapshotDays = Number(argv[(i += 1)]);
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (a.startsWith('-')) {
      process.stderr.write(`unknown option ${a}\n\n${USAGE}`);
      process.exit(2);
    } else rest.push(a);
  }
  if (rest.length) o.command = rest[0];
  return o;
}

let lastWasProgress = false;
function log(msg, progress = false) {
  if (lastWasProgress) process.stderr.write('\r\x1b[K');
  process.stderr.write(progress ? `  ${msg}` : `  ${msg}\n`);
  lastWasProgress = progress;
}
const kb = (n) => (n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * Assemble a standalone copy of the site.
 *
 * The repository root already *is* the site — index.html imports from src/ —
 * so this mirrors that layout rather than inventing a second one, and the same
 * relative paths work whether you serve the repo or the copy.
 */
function webAssets(outDir) {
  const dest = path.resolve(outDir);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.join(dest, 'src'), { recursive: true });
  for (const f of ['index.html', 'app.js']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
  }
  for (const f of ['palette.js', 'lanes.js', 'payload.js', 'github.js', 'player.html']) {
    fs.copyFileSync(path.join(ROOT, 'src', f), path.join(dest, 'src', f));
  }
  fs.writeFileSync(path.join(dest, '.nojekyll'), '');
  log(`assembled ${path.relative(process.cwd(), dest)}/ for static hosting`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.command === 'web-assets') {
    webAssets(opts.out === '.sediment' ? '_site' : opts.out);
    return;
  }
  if (opts.command !== 'build') {
    process.stderr.write(`unknown command ${opts.command}\n\n${USAGE}`);
    process.exit(2);
  }

  const repoRoot = path.resolve(opts.repo);
  const outDir = path.resolve(opts.out);
  fs.mkdirSync(outDir, { recursive: true });

  log(`reading ${repoName(repoRoot)} at ${repoRoot}`);
  const data = extract({
    repoRoot,
    snapshotDays: opts.snapshotDays,
    maxLanes: opts.lanes,
    log,
  });

  if (data.meta.shallow) {
    log('WARNING: this is a shallow clone — only the fetched commits are covered.');
    log('         run `git fetch --unshallow` first for the whole history.');
  }

  data.meta.note = `Every ${data.meta.units.slice(0, -1)} counted exactly from git. Built with sediment.`;
  const payload = buildPayload({
    meta: data.meta,
    lanes: data.lanes,
    commits: data.commits,
    snapshots: data.snapshots,
    releases: data.releases,
    contributors: data.contributors,
    fileEvents: data.fileEvents,
  });

  const pagePath = path.join(outDir, 'index.html');
  fs.writeFileSync(pagePath, buildHtml(fs.readFileSync(TEMPLATE, 'utf8'), payload), 'utf8');
  log(`wrote ${path.relative(process.cwd(), pagePath)} (${kb(fs.statSync(pagePath).size)})`);

  if (opts.json) {
    const dataDir = path.join(outDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    for (const [name, value] of Object.entries({
      meta: data.meta,
      commits: data.commits,
      'file-events': data.fileEvents,
      daily: data.daily,
      snapshots: data.snapshots,
      contributors: data.contributors,
      releases: data.releases,
      files: data.files,
      derived: data.derived,
    })) {
      fs.writeFileSync(path.join(dataDir, `${name}.json`), `${JSON.stringify(value)}\n`);
    }
    log(`wrote ${path.relative(process.cwd(), dataDir)}/ (9 datasets)`);
  }

  log(
    `${data.meta.commits} commits · ${data.meta.contributors} contributors · ` +
      `${data.meta.filesAlive} files · ${data.meta.finalLoc} lines · ` +
      `${data.meta.range.firstDate} to ${data.meta.range.lastDate}`
  );
  log(`lanes: ${data.lanes.labels.join(', ')}`);

  if (opts.video) {
    const { record } = await import('../src/record.js');
    const result = await record({
      page: pagePath,
      out: path.join(outDir, 'sediment.mp4'),
      seconds: opts.seconds,
      fps: opts.fps,
      width: opts.width,
      height: opts.height,
      theme: opts.theme,
      hold: opts.hold,
      gif: opts.gif,
      log,
    });
    log(`wrote ${path.relative(process.cwd(), result.mp4)} (${kb(result.bytes)})`);
    if (result.gif)
      log(`wrote ${path.relative(process.cwd(), result.gif)} (${kb(result.gifBytes)})`);
  }
}

main().catch((err) => {
  process.stderr.write(`\nsediment: ${err.message}\n`);
  process.exit(1);
});
