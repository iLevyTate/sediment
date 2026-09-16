/**
 * Put the phone recording in a device frame on a 1080x1920 canvas, and hang an
 * end card off the back of it.
 *
 * The frame is one PNG with a hole where the screen goes: everything outside
 * the screen rectangle is drawn in a browser, masked, and laid over the video,
 * so the corners of the recording are covered rather than clipped in ffmpeg.
 *
 * Usage: node tools/social/compose.mjs [--screen .social/screen.mp4] [--out .social/sediment-social.mp4]
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FONT_DIR = path.join(HERE, '.fonts');
const FFMPEG = process.env.SEDIMENT_FFMPEG || 'ffmpeg';

const W = 1080;
const H = 1920;
const SCREEN = { w: 740, h: 1604, x: 170, y: 158 }; // 393x852 at 1.883, centred
const BEZEL = 15;
const FPS = 30;
// Seconds of end card, and of dip into it. A short cut cannot spend five
// seconds on a still, so both shrink when the recording is a Shorts-length one.
const OUTRO_LONG = 5.4;
const OUTRO_SHORT = 3.2;
const FADE_LONG = 0.8;
const FADE_SHORT = 0.6;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const screenPath = path.resolve(arg('screen', path.join(ROOT, '.social/screen.mp4')));
const outPath = path.resolve(arg('out', path.join(ROOT, '.social/sediment-social.mp4')));
const outDir = path.dirname(outPath);

const run = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('error', (e) => reject(new Error(`could not run ffmpeg (${e.message})`)));
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}):\n${err.slice(-1400)}`))
    );
  });

const probe = (file) =>
  new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('close', () => {
      const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
      if (!m) reject(new Error(`could not read a duration from ${file}`));
      else resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
  });

// ---- the two stills, drawn in a browser ------------------------------------
/** Everything the page and the end card share: ground, glow, strata. */
const BASE_CSS = `
  @font-face { font-family: 'Plex Sans'; src: local('IBM Plex Sans'); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; }
  body {
    font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
    color: #e9ecf3;
    -webkit-font-smoothing: antialiased;
  }
  /* Light enough in the middle for a dark phone to sit against it, dark at
     the corners so nothing competes with the screen. */
  .ground {
    position: absolute; inset: 0;
    background:
      radial-gradient(78% 42% at 50% 34%, rgba(92,184,191,.20), rgba(92,184,191,0) 68%),
      radial-gradient(70% 34% at 50% 98%, rgba(161,74,48,.14), rgba(161,74,48,0) 72%),
      radial-gradient(120% 78% at 50% 44%, #16202a 0%, #0d141b 46%, #05080b 100%);
  }
  /* The lane ramp from src/palette.js, as strata banding the ends. */
  .strata { position: absolute; left: 0; right: 0; height: 100%; }
  .strata i { position: absolute; left: -6%; width: 112%; display: block; filter: blur(7px); }
`;
const RAMP = ['#7ea465', '#a14a30', '#3e7ca8', '#b47f22', '#32939a', '#666f7f', '#719353', '#787836'];
/** Faint bands top and bottom, thicker and more opaque the further out they go. */
const strata = (from, to, count, dir) => {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const p = count === 1 ? 0 : i / (count - 1);
    const y = from + (to - from) * p;
    const h = 14 + p * 54;
    const a = (0.06 + p * 0.20).toFixed(3);
    out += `<i style="top:${Math.round(y)}px;height:${Math.round(h)}px;background:${
      RAMP[(dir + i) % RAMP.length]
    };opacity:${a}"></i>`;
  }
  return out;
};

const overlayHtml = () => {
  const b = { x: SCREEN.x - BEZEL, y: SCREEN.y - BEZEL, w: SCREEN.w + BEZEL * 2, h: SCREEN.h + BEZEL * 2 };
  const r = 58;
  // A mask that is opaque everywhere but the screen, so the recording shows
  // through the hole and its square corners are covered.
  const mask = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<path fill="#fff" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z` +
      `M${SCREEN.x + r} ${SCREEN.y}h${SCREEN.w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}` +
      `v${SCREEN.h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${SCREEN.w - 2 * r}` +
      `a${r} ${r} 0 0 1 -${r} -${r}v-${SCREEN.h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z"/></svg>`
  );
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}
    .sheet {
      position: absolute; inset: 0;
      -webkit-mask-image: url("data:image/svg+xml,${mask}");
      -webkit-mask-size: ${W}px ${H}px;
    }
    .body {
      position: absolute;
      left: ${b.x}px; top: ${b.y}px; width: ${b.w}px; height: ${b.h}px;
      border-radius: ${r + BEZEL}px;
      background: linear-gradient(148deg, #5c6a78 0%, #2a333c 16%, #10161c 46%, #0c1116 72%, #47535f 100%);
      box-shadow:
        0 0 0 1.5px rgba(233,236,243,.10),
        0 50px 120px -34px rgba(0,0,0,.95),
        0 0 190px -20px rgba(92,184,191,.30);
    }
    /* Glass edge: a bright hairline just inside the bezel, dark just outside. */
    .rim {
      position: absolute;
      left: ${SCREEN.x - 2}px; top: ${SCREEN.y - 2}px;
      width: ${SCREEN.w + 4}px; height: ${SCREEN.h + 4}px;
      border-radius: ${r + 2}px;
      box-shadow:
        inset 0 0 0 1px rgba(0,0,0,.85),
        inset 0 0 0 2.5px rgba(233,236,243,.16);
    }
  </style>
  <div class="sheet">
    <div class="ground"></div>
    <div class="strata">${strata(84, -46, 4, 0)}${strata(1836, 1966, 4, 3)}</div>
    <div class="body"></div>
  </div>
  <div class="rim"></div>`;
};

const endcardHtml = () => `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}
  .wrap {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 34px; padding: 0 96px; text-align: center;
  }
  h1 {
    font-family: 'IBM Plex Sans Condensed', ui-sans-serif, sans-serif;
    font-weight: 700; font-size: 136px; letter-spacing: -.022em; line-height: 1;
  }
  h1 em { font-style: normal; color: #5cb8bf; }
  .rule { display: flex; width: 560px; height: 7px; border-radius: 4px; overflow: hidden; }
  .rule i { flex: 1; }
  p.tag {
    font-size: 40px; line-height: 1.42; color: #b9c2cf; max-width: 760px; text-wrap: balance;
  }
  .cmd {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 33px; color: #e9ecf3;
    padding: 26px 40px; border-radius: 16px;
    background: rgba(255,255,255,.045); border: 1px solid rgba(233,236,243,.12);
  }
  .url {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 31px; color: #5cb8bf; letter-spacing: .01em;
  }
  </style>
  <div class="ground"></div>
  <div class="strata">${strata(170, -10, 5, 2)}${strata(1750, 1930, 5, 5)}</div>
  <div class="wrap">
    <h1>Sed<em>iment</em></h1>
    <div class="rule">${RAMP.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
    <p class="tag">Turn any git repository's history into a stratigraphic film.</p>
    <div class="cmd">npx github:iLevyTate/sediment</div>
    <div class="url">ilevytate.github.io/sediment</div>
  </div>`;

async function stills() {
  const { chromium } = await import(process.env.SEDIMENT_PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const cssPath = path.join(FONT_DIR, 'plex.css');
  if (fs.existsSync(cssPath)) {
    const css = fs.readFileSync(cssPath, 'utf8');
    await context.route('https://fonts.googleapis.com/**', (r) =>
      r.fulfill({ contentType: 'text/css; charset=utf-8', body: css })
    );
    await context.route('https://fonts.gstatic.com/**', (r) => {
      const file = path.join(FONT_DIR, path.basename(r.request().url()));
      return fs.existsSync(file)
        ? r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(file) })
        : r.abort();
    });
  }
  const page = await context.newPage();
  const shoot = async (html, file, transparent) => {
    await page.setContent(
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500&display=swap">${html}`,
      { waitUntil: 'load' }
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file, omitBackground: transparent });
  };
  await shoot(overlayHtml(), path.join(outDir, 'frame.png'), true);
  await shoot(endcardHtml(), path.join(outDir, 'endcard.png'), false);
  await browser.close();
}

async function main() {
  if (!fs.existsSync(screenPath)) throw new Error(`no recording at ${screenPath}`);
  fs.mkdirSync(outDir, { recursive: true });
  await stills();

  const screenSeconds = await probe(screenPath);
  const short = screenSeconds < 30;
  const OUTRO = Number(arg('outro', short ? OUTRO_SHORT : OUTRO_LONG));
  const FADE = Number(arg('fade', short ? FADE_SHORT : FADE_LONG));
  const filter = [
    // The recording, scaled into the hole and laid on the canvas. It dips out
    // at the end rather than cross-fading: xfade wants a newer ffmpeg than the
    // oldest one this is likely to meet, and a beat of black reads better
    // before a card anyway.
    `[0:v]scale=${SCREEN.w}:${SCREEN.h}:flags=lanczos,` +
      `pad=${W}:${H}:${SCREEN.x}:${SCREEN.y}:color=0x05070a,setsar=1[bed]`,
    `[1:v]format=rgba[frame]`,
    `[bed][frame]overlay=0:0:format=auto,format=yuv420p,fps=${FPS},` +
      `fade=t=out:st=${(screenSeconds - FADE).toFixed(3)}:d=${FADE}[main]`,
    `[2:v]scale=${W}:${H},setsar=1,format=yuv420p,fps=${FPS},fade=t=in:st=0:d=${FADE}[card]`,
    `[main][card]concat=n=2:v=1:a=0[v]`,
  ].join(';');

  await run([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', screenPath,
    '-loop', '1', '-t', String(screenSeconds), '-i', path.join(outDir, 'frame.png'),
    '-loop', '1', '-t', String(OUTRO), '-i', path.join(outDir, 'endcard.png'),
    // Social players prefer a track to no track at all.
    '-f', 'lavfi', '-t', String(screenSeconds + OUTRO),
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex', filter,
    '-map', '[v]', '-map', '3:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-profile:v', 'high', '-level', '4.1',
    '-pix_fmt', 'yuv420p', '-g', String(FPS * 2), '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-shortest', outPath,
  ]);

  const seconds = await probe(outPath);
  process.stdout.write(
    `wrote ${outPath} — ${seconds.toFixed(1)}s, ${W}x${H}, ` +
      `${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
