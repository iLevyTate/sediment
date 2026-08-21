/**
 * Record a built player page to video.
 *
 * The page is opened at `#film`, which drops the live-viewer chrome and hands
 * frame timing to `window.__strata`. Each frame steps exactly 1/fps of video
 * time, so the output does not depend on how fast this machine can screenshot —
 * and, since the grain simulation is seeded, is identical every run. Frames pipe
 * straight into ffmpeg rather than being staged on disk.
 *
 * Needs playwright (optional dependency) and ffmpeg on PATH.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

function runFfmpeg(label, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('error', (e) =>
      reject(new Error(`${label}: could not run ffmpeg (${e.message}). Is it on PATH?`))
    );
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed (${code}):\n${err.slice(-1200)}`))
    );
  });
}

/** Two-pass GIF: a per-clip palette handles gradient-heavy strata far better. */
async function toGif(mp4Path, gifPath, width, fps) {
  const palette = path.join(path.dirname(gifPath), '.sediment-palette.png');
  const filters = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  await runFfmpeg('palettegen', [
    '-y',
    '-i',
    mp4Path,
    '-vf',
    `${filters},palettegen=stats_mode=diff`,
    palette,
  ]);
  await runFfmpeg('paletteuse', [
    '-y',
    '-i',
    mp4Path,
    '-i',
    palette,
    '-lavfi',
    `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    gifPath,
  ]);
  fs.unlinkSync(palette);
}

/**
 * @param {object} o
 * @param {string} o.page  path to the built html
 * @param {string} o.out   path to the mp4
 */
export async function record({
  page: pagePath,
  out,
  seconds = 30,
  fps = 30,
  width = 1920,
  height = 1080,
  theme = 'dark',
  hold = 3,
  gif = false,
  gifWidth = 900,
  gifFps = 12,
  log = () => {},
}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'recording needs playwright — install it with `npm i -D playwright` and `npx playwright install chromium`'
    );
  }

  const outPath = path.resolve(out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const url = `${pathToFileURL(path.resolve(pagePath)).href}#film`;

  const browser = await chromium.launch({
    executablePath: process.env.SEDIMENT_CHROMIUM || undefined,
    args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: theme === 'light' ? 'light' : 'dark',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__strata), null, {
    timeout: 20000,
  });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(600);

  const intro = await page.evaluate(() => window.__strata.intro || 0);
  const runFrames = Math.round((intro + seconds) * fps);
  const holdFrames = Math.round(hold * fps);
  await page.evaluate((s) => {
    window.__strata.setSpeed(46 / s);
    window.__strata.reset();
  }, seconds);
  log(`${intro}s title + ${seconds}s deposition + ${hold}s hold @ ${fps}fps, ${width}x${height}`);

  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y',
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      '-r',
      String(fps),
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-r',
      String(fps),
      outPath,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );
  let ffErr = '';
  ffmpeg.stderr.on('data', (d) => {
    ffErr += d.toString();
  });
  const encoded = new Promise((resolve, reject) => {
    ffmpeg.on('error', (e) =>
      reject(new Error(`could not run ffmpeg (${e.message}). Is it on PATH?`))
    );
    ffmpeg.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}):\n${ffErr.slice(-1500)}`))
    );
  });
  const write = (buf) =>
    ffmpeg.stdin.write(buf) ? Promise.resolve() : new Promise((r) => ffmpeg.stdin.once('drain', r));

  const dt = 1 / fps;
  const total = runFrames + holdFrames;
  for (let f = 0; f < total; f += 1) {
    await page.evaluate((step) => window.__strata.step(step), dt);
    await write(await page.screenshot({ type: 'png' }));
    if (f % Math.max(1, fps * 2) === 0) log(`frame ${f + 1}/${total}`, true);
  }
  log(`frame ${total}/${total}`, true);
  log('');

  ffmpeg.stdin.end();
  await encoded;
  await browser.close();
  if (errors.length) log(`page errors: ${errors.join('; ')}`);

  const result = { mp4: outPath, bytes: fs.statSync(outPath).size };
  if (gif) {
    const gifPath = outPath.replace(/\.mp4$/, '.gif');
    await toGif(outPath, gifPath, gifWidth, gifFps);
    result.gif = gifPath;
    result.gifBytes = fs.statSync(gifPath).size;
  }
  return result;
}
