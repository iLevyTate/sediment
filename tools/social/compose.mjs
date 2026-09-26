/**
 * Put the recordings in device frames and hang an end card off the back.
 *
 *   --layout tall  (default) the phone recording on a 1080x1920 canvas, for
 *                  Reels, TikTok and Shorts.
 *   --layout wide  the desktop recording in a browser window with the phone
 *                  recording beside it, on 1920x1080, for anywhere a video
 *                  plays landscape. Both recordings run on the long cut's
 *                  clock, so their films deposit in step.
 *
 * Every frame is a PNG with holes where the screens go: everything outside
 * the screens is drawn in a browser, masked, and laid over the video, so the
 * corners of each recording are covered rather than clipped in ffmpeg.
 *
 * Usage:
 *   node tools/social/compose.mjs [--screen .social/screen.mp4] [--out FILE]
 *   node tools/social/compose.mjs --layout wide
 *     [--desktop .social/screen-desktop.mp4] [--phone .social/screen.mp4] [--out FILE]
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FONT_DIR = path.join(HERE, '.fonts');
const FFMPEG = process.env.SEDIMENT_FFMPEG || 'ffmpeg';

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
const LAYOUT = arg('layout', 'tall') === 'wide' ? 'wide' : 'tall';

// Tall: one phone, centred. 393x852 at 1.883.
const TALL = { w: 1080, h: 1920 };
const SCREEN = { w: 740, h: 1604, x: 170, y: 158 };
const BEZEL = 15;

// Wide: a browser window holding the 1440x900 desktop recording at 0.944, and
// the phone in front of its right edge. The phone only overlaps the window's
// empty margin, never the app, and the pair is centred as one group.
const WIDE = { w: 1920, h: 1080 };
const WIN = { x: 118, y: 93, w: 1360, bar: 44, r: 14 };
const VIEWPORT = { x: WIN.x, y: WIN.y + WIN.bar, w: 1360, h: 850 };
const PHONE = { x: 1420, y: 182, w: 370, h: 802, bezel: 12, r: 30 };

const outPath = path.resolve(
  arg(
    'out',
    path.join(
      ROOT,
      LAYOUT === 'wide' ? '.social/sediment-wide-1920x1080.mp4' : '.social/sediment-social.mp4'
    )
  )
);
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
    const proc = spawn(FFMPEG, ['-hide_banner', '-i', file], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
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
/** Everything the frames and the end cards share: ground, glow, strata. */
const baseCss = ({ w, h }) => `
  @font-face { font-family: 'Plex Sans'; src: local('IBM Plex Sans'); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${w}px; height: ${h}px; }
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
const RAMP = [
  '#7ea465',
  '#a14a30',
  '#3e7ca8',
  '#b47f22',
  '#32939a',
  '#666f7f',
  '#719353',
  '#787836',
];
/** Faint bands top and bottom, thicker and more opaque the further out they go. */
const strata = (from, to, count, dir) => {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const p = count === 1 ? 0 : i / (count - 1);
    const y = from + (to - from) * p;
    const h = 14 + p * 54;
    const a = (0.06 + p * 0.2).toFixed(3);
    out += `<i style="top:${Math.round(y)}px;height:${Math.round(h)}px;background:${
      RAMP[(dir + i) % RAMP.length]
    };opacity:${a}"></i>`;
  }
  return out;
};

/**
 * A rounded rectangle as an SVG subpath. `r` rounds all four corners;
 * `top: false` leaves the top two square, for a window's content under its bar.
 */
const roundRect = ({ x, y, w, h }, r, top = true) => {
  const t = top ? r : 0;
  return (
    `M${x + t} ${y}h${w - t - r}` +
    (top ? `a${r} ${r} 0 0 1 ${r} ${r}` : `h${r}`) +
    `v${h - t - r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}` +
    `v-${h - t - r}` +
    (top ? `a${r} ${r} 0 0 1 ${r} -${r}` : `h${t}`) +
    'z'
  );
};
/** An SVG mask, opaque everywhere on a canvas but the holes it is given. */
const holes = ({ w, h }, ...paths) =>
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<path fill="#fff" fill-rule="evenodd" d="M0 0H${w}V${h}H0Z${paths.join('')}"/></svg>`
  );

const overlayHtml = () => {
  const b = {
    x: SCREEN.x - BEZEL,
    y: SCREEN.y - BEZEL,
    w: SCREEN.w + BEZEL * 2,
    h: SCREEN.h + BEZEL * 2,
  };
  const r = 58;
  // A mask that is opaque everywhere but the screen, so the recording shows
  // through the hole and its square corners are covered.
  const mask = holes(TALL, roundRect(SCREEN, r));
  return `<!doctype html><meta charset="utf-8"><style>${baseCss(TALL)}
    .sheet {
      position: absolute; inset: 0;
      -webkit-mask-image: url("data:image/svg+xml,${mask}");
      -webkit-mask-size: ${TALL.w}px ${TALL.h}px;
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

/** The end card, at either shape. Wide gets bigger type and shallower strata. */
const endcardHtml = (canvas) => {
  const wide = canvas.w > canvas.h;
  const bands = wide
    ? `${strata(90, -10, 5, 2)}${strata(962, 1090, 5, 5)}`
    : `${strata(170, -10, 5, 2)}${strata(1750, 1930, 5, 5)}`;
  return `<!doctype html><meta charset="utf-8"><style>${baseCss(canvas)}
  .wrap {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: ${wide ? 30 : 34}px; padding: 0 96px; text-align: center;
  }
  h1 {
    font-family: 'IBM Plex Sans Condensed', ui-sans-serif, sans-serif;
    font-weight: 700; font-size: ${wide ? 150 : 136}px; letter-spacing: -.022em; line-height: 1;
  }
  h1 em { font-style: normal; color: #5cb8bf; }
  .rule { display: flex; width: ${wide ? 620 : 560}px; height: 7px; border-radius: 4px; overflow: hidden; }
  .rule i { flex: 1; }
  p.tag {
    font-size: ${wide ? 38 : 40}px; line-height: 1.42; color: #b9c2cf;
    max-width: ${wide ? 1100 : 760}px; text-wrap: balance;
  }
  .cmd {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: ${wide ? 32 : 33}px; color: #e9ecf3;
    padding: 26px 40px; border-radius: 16px;
    background: rgba(255,255,255,.045); border: 1px solid rgba(233,236,243,.12);
  }
  .url {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: ${wide ? 30 : 31}px; color: #5cb8bf; letter-spacing: .01em;
  }
  </style>
  <div class="ground"></div>
  <div class="strata">${bands}</div>
  <div class="wrap">
    <h1>Sed<em>iment</em></h1>
    <div class="rule">${RAMP.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
    <p class="tag">Turn any git repository's history into a stratigraphic film.</p>
    <div class="cmd">npx github:iLevyTate/sediment</div>
    <div class="url">ilevytate.github.io/sediment</div>
  </div>`;
};

/**
 * Wide, back layer: ground and the browser window, with a hole where the
 * desktop recording shows through. Generic window chrome, not any real
 * browser's: three dots and an address pill.
 */
const wideBackHtml = () => {
  const winH = WIN.bar + VIEWPORT.h;
  const mask = holes(WIDE, roundRect(VIEWPORT, WIN.r, false));
  return `<!doctype html><meta charset="utf-8"><style>${baseCss(WIDE)}
    .sheet {
      position: absolute; inset: 0;
      -webkit-mask-image: url("data:image/svg+xml,${mask}");
      -webkit-mask-size: ${WIDE.w}px ${WIDE.h}px;
    }
    .window {
      position: absolute; left: ${WIN.x}px; top: ${WIN.y}px; width: ${WIN.w}px; height: ${winH}px;
      border-radius: ${WIN.r}px; background: #0b0f13;
      box-shadow:
        0 0 0 1px rgba(233,236,243,.10),
        0 40px 110px -30px rgba(0,0,0,.9),
        0 0 220px -40px rgba(92,184,191,.26);
    }
    .bar {
      position: absolute; left: 0; right: 0; top: 0; height: ${WIN.bar}px;
      border-radius: ${WIN.r}px ${WIN.r}px 0 0;
      background: linear-gradient(180deg, #232a32, #1a2027);
      border-bottom: 1px solid rgba(0,0,0,.6);
    }
    .dots { position: absolute; left: 18px; top: 16px; display: flex; gap: 8px; }
    .dots i { width: 12px; height: 12px; border-radius: 50%; background: #3a434d; }
    .address {
      position: absolute; left: 50%; top: 9px; transform: translateX(-50%);
      width: 520px; height: 26px; border-radius: 13px; background: #11161b;
      border: 1px solid rgba(233,236,243,.07);
      font: 500 13px/26px 'IBM Plex Mono', ui-monospace, monospace; color: #a8b0be;
      text-align: center; letter-spacing: .01em;
    }
    .address b { color: #5cb8bf; font-weight: 500; }
  </style>
  <div class="sheet">
    <div class="ground"></div>
    <div class="strata">${strata(60, -30, 4, 0)}${strata(1000, 1090, 4, 3)}</div>
    <div class="window">
      <div class="bar">
        <div class="dots"><i></i><i></i><i></i></div>
        <div class="address">ilevytate.github.io/<b>sediment</b></div>
      </div>
    </div>
  </div>`;
};

/**
 * Wide, front layer: the phone alone on a transparent sheet, with a hole for
 * its screen. Its shadow is part of this layer, so it falls across the
 * browser window behind it as well as the ground.
 */
const widePhoneHtml = () => {
  const b = {
    x: PHONE.x - PHONE.bezel,
    y: PHONE.y - PHONE.bezel,
    w: PHONE.w + PHONE.bezel * 2,
    h: PHONE.h + PHONE.bezel * 2,
  };
  const mask = holes(WIDE, roundRect(PHONE, PHONE.r));
  return `<!doctype html><meta charset="utf-8"><style>${baseCss(WIDE)}
    html, body { background: transparent; }
    .sheet {
      position: absolute; inset: 0;
      -webkit-mask-image: url("data:image/svg+xml,${mask}");
      -webkit-mask-size: ${WIDE.w}px ${WIDE.h}px;
    }
    .body {
      position: absolute; left: ${b.x}px; top: ${b.y}px; width: ${b.w}px; height: ${b.h}px;
      border-radius: ${PHONE.r + PHONE.bezel}px;
      background: linear-gradient(148deg, #5c6a78 0%, #2a333c 16%, #10161c 46%, #0c1116 72%, #47535f 100%);
      box-shadow:
        0 0 0 1px rgba(233,236,243,.12),
        -18px 30px 70px -10px rgba(0,0,0,.85),
        0 0 120px -20px rgba(92,184,191,.22);
    }
    .rim {
      position: absolute;
      left: ${PHONE.x - 1.5}px; top: ${PHONE.y - 1.5}px;
      width: ${PHONE.w + 3}px; height: ${PHONE.h + 3}px;
      border-radius: ${PHONE.r + 1.5}px;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,.85), inset 0 0 0 2px rgba(233,236,243,.14);
    }
  </style>
  <div class="sheet"><div class="body"></div></div>
  <div class="rim"></div>`;
};

async function stills() {
  const { chromium } = await import(process.env.SEDIMENT_PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });
  const canvas = LAYOUT === 'wide' ? WIDE : TALL;
  const context = await browser.newContext({
    viewport: { width: canvas.w, height: canvas.h },
    deviceScaleFactor: 1,
  });
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
  if (LAYOUT === 'wide') {
    await shoot(wideBackHtml(), path.join(outDir, 'wide-back.png'), true);
    await shoot(widePhoneHtml(), path.join(outDir, 'wide-phone.png'), true);
    await shoot(endcardHtml(WIDE), path.join(outDir, 'endcard-wide.png'), false);
  } else {
    await shoot(overlayHtml(), path.join(outDir, 'frame.png'), true);
    await shoot(endcardHtml(TALL), path.join(outDir, 'endcard.png'), false);
  }
  await browser.close();
}

/**
 * One pass through ffmpeg: the inputs, a filter graph that ends in [v], and a
 * silent stereo track, because social players prefer a track to no track.
 */
async function encode(inputs, filter, seconds, canvas) {
  await run([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs.flat(),
    '-f',
    'lavfi',
    '-t',
    String(seconds),
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    `${inputs.length}:a`,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '19',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(FPS * 2),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-shortest',
    outPath,
  ]);
  const got = await probe(outPath);
  process.stdout.write(
    `wrote ${outPath} — ${got.toFixed(1)}s, ${canvas.w}x${canvas.h}, ` +
      `${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB\n`
  );
}

const still = (file, seconds) => ['-loop', '1', '-t', String(seconds), '-i', file];
const clip = (file) => ['-i', file];

/** The dip to black, then the card fading up out of it. Shared by both shapes. */
const outro = (canvas, fade, cardInput) => [
  `[${cardInput}:v]scale=${canvas.w}:${canvas.h},setsar=1,format=yuv420p,fps=${FPS},` +
    `fade=t=in:st=0:d=${fade}[card]`,
  `[main][card]concat=n=2:v=1:a=0[v]`,
];

async function composeTall() {
  const screenPath = path.resolve(arg('screen', path.join(ROOT, '.social/screen.mp4')));
  if (!fs.existsSync(screenPath)) throw new Error(`no recording at ${screenPath}`);
  const seconds = await probe(screenPath);
  const short = seconds < 30;
  const OUTRO = Number(arg('outro', short ? OUTRO_SHORT : OUTRO_LONG));
  const FADE = Number(arg('fade', short ? FADE_SHORT : FADE_LONG));
  const filter = [
    // The recording, scaled into the hole and laid on the canvas. It dips out
    // at the end rather than cross-fading: xfade wants a newer ffmpeg than the
    // oldest one this is likely to meet, and a beat of black reads better
    // before a card anyway.
    `[0:v]scale=${SCREEN.w}:${SCREEN.h}:flags=lanczos,` +
      `pad=${TALL.w}:${TALL.h}:${SCREEN.x}:${SCREEN.y}:color=0x05070a,setsar=1[bed]`,
    `[1:v]format=rgba[frame]`,
    `[bed][frame]overlay=0:0:format=auto,format=yuv420p,fps=${FPS},` +
      `fade=t=out:st=${(seconds - FADE).toFixed(3)}:d=${FADE}[main]`,
    ...outro(TALL, FADE, 2),
  ].join(';');
  await encode(
    [
      clip(screenPath),
      still(path.join(outDir, 'frame.png'), seconds),
      still(path.join(outDir, 'endcard.png'), OUTRO),
    ],
    filter,
    seconds + OUTRO,
    TALL
  );
}

async function composeWide() {
  const desktopPath = path.resolve(arg('desktop', path.join(ROOT, '.social/screen-desktop.mp4')));
  const phonePath = path.resolve(arg('phone', path.join(ROOT, '.social/screen.mp4')));
  for (const file of [desktopPath, phonePath]) {
    if (!fs.existsSync(file)) throw new Error(`no recording at ${file}`);
  }
  const seconds = await probe(desktopPath);
  const phoneSeconds = await probe(phonePath);
  // Both are recorded against the long cut's clock. If one has been re-cut
  // and the other not, the films no longer deposit together, and the frame
  // would say so more loudly than this does.
  if (Math.abs(seconds - phoneSeconds) > 0.2) {
    throw new Error(
      `the desktop recording runs ${seconds.toFixed(1)}s and the phone ${phoneSeconds.toFixed(1)}s; ` +
        'record both from the same cut'
    );
  }
  const OUTRO = Number(arg('outro', OUTRO_LONG));
  const FADE = Number(arg('fade', FADE_LONG));
  const filter = [
    `[0:v]scale=${VIEWPORT.w}:${VIEWPORT.h}:flags=lanczos,setsar=1,` +
      `pad=${WIDE.w}:${WIDE.h}:${VIEWPORT.x}:${VIEWPORT.y}:color=0x05070a[desk]`,
    `[2:v]format=rgba[back]`,
    `[desk][back]overlay=0:0:format=auto[room]`,
    `[1:v]scale=${PHONE.w}:${PHONE.h}:flags=lanczos,setsar=1[phone]`,
    `[room][phone]overlay=${PHONE.x}:${PHONE.y}[held]`,
    `[3:v]format=rgba[body]`,
    `[held][body]overlay=0:0:format=auto,format=yuv420p,fps=${FPS},` +
      `fade=t=out:st=${(seconds - FADE).toFixed(3)}:d=${FADE}[main]`,
    ...outro(WIDE, FADE, 4),
  ].join(';');
  await encode(
    [
      clip(desktopPath),
      clip(phonePath),
      still(path.join(outDir, 'wide-back.png'), seconds),
      still(path.join(outDir, 'wide-phone.png'), seconds),
      still(path.join(outDir, 'endcard-wide.png'), OUTRO),
    ],
    filter,
    seconds + OUTRO,
    WIDE
  );
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  await stills();
  if (LAYOUT === 'wide') await composeWide();
  else await composeTall();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
