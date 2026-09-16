/**
 * Record a phone-shaped walkthrough of the hosted page for a social clip.
 *
 * Every frame is driven, not sampled. The page is served locally, the player's
 * requestAnimationFrame inside the film iframe is replaced by a pump this
 * script calls exactly once per output frame, and the scroll positions are set
 * per frame from an eased timeline. So the recording is smooth and repeatable
 * however slowly the machine screenshots, the same trick src/record.js uses.
 *
 * Output is the raw phone screen at 2x (786x1704). tools/social/compose.mjs
 * puts it in a device frame on a 1080x1920 canvas.
 *
 * Needs playwright and ffmpeg. Web fonts are fetched once to tools/social/
 * .fonts and served from there, so a machine with no route to Google Fonts
 * still records the real typography.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FONT_DIR = path.join(HERE, '.fonts');
const FFMPEG = process.env.SEDIMENT_FFMPEG || 'ffmpeg';

const FPS = Number(process.env.SEDIMENT_SOCIAL_FPS || 30);
const VIEW = { width: 393, height: 852 }; // iPhone 14 Pro, CSS pixels
const SCALE = 2;
const PORT = 8771;
const FILM_START = 1; // seconds of video before the film's own clock starts

const args = process.argv.slice(2);
const outPath = path.resolve(
  (args[args.indexOf('--out') + 1] && args.includes('--out') && args[args.indexOf('--out') + 1]) ||
    path.join(ROOT, '.social/screen.mp4')
);

// ---- a static server, so the page runs from http rather than file: ---------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
};
function serve(dir, port) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// ---- web fonts, cached next to this script --------------------------------
const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600' +
  '&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500&display=swap';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

async function fonts() {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const cssPath = path.join(FONT_DIR, 'plex.css');
  if (!fs.existsSync(cssPath)) {
    const css = await fetch(FONT_CSS_URL, { headers: { 'User-Agent': CHROME_UA } }).then((r) =>
      r.text()
    );
    fs.writeFileSync(cssPath, css);
  }
  const css = fs.readFileSync(cssPath, 'utf8');
  for (const url of [...new Set(css.match(/https:\/\/fonts\.gstatic\.com[^)]+/g) || [])]) {
    const file = path.join(FONT_DIR, path.basename(url));
    if (fs.existsSync(file)) continue;
    const buf = Buffer.from(
      await fetch(url, { headers: { 'User-Agent': CHROME_UA } }).then((r) => r.arrayBuffer())
    );
    fs.writeFileSync(file, buf);
  }
  return css;
}

// ---- easing ---------------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** Smooth both ends: what a thumb-flick scroll looks like. */
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Lands softly, like momentum running out. */
const easeOut = (x) => 1 - (1 - x) ** 3;
const mix = (a, b, x) => a + (b - a) * x;
/** Position on a leg of a scroll: hold, move, hold. */
function leg(t, start, end, from, to, ease = easeInOut) {
  if (t <= start) return from;
  if (t >= end) return to;
  return mix(from, to, ease(clamp01((t - start) / (end - start))));
}

const log = (m) => process.stdout.write(`${m}\n`);

async function main() {
  const css = await fonts();
  const server = await serve(ROOT, PORT);
  // Resolvable from a global install too, which is how CI and a bare clone
  // most often have playwright.
  const { chromium } = await import(process.env.SEDIMENT_PLAYWRIGHT || 'playwright');

  const browser = await chromium.launch({
    args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
  });
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    permissions: ['clipboard-read', 'clipboard-write'],
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  await context.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css; charset=utf-8', body: css })
  );
  await context.route('https://fonts.gstatic.com/**', (route) => {
    const file = path.join(FONT_DIR, path.basename(route.request().url()));
    return fs.existsSync(file)
      ? route.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(file) })
      : route.abort();
  });

  // Freeze animation inside the film iframe so this script owns its clock.
  await context.addInitScript(() => {
    if (window.top === window) return;
    const queued = [];
    let id = 1;
    window.requestAnimationFrame = (cb) => {
      queued.push([id, cb]);
      return id++;
    };
    window.cancelAnimationFrame = (handle) => {
      const i = queued.findIndex((q) => q[0] === handle);
      if (i >= 0) queued.splice(i, 1);
    };
    window.__pump = (ts) => {
      for (const [, cb] of queued.splice(0, queued.length)) {
        try {
          cb(ts);
        } catch {
          /* a dropped frame callback must not stop the recording */
        }
      }
    };
  });

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  // The demo payload is a 750 KB fetch, and the film only exists once it lands.
  await page.waitForSelector('#film.ready', { timeout: 60000 });
  const film = page.frames().find((f) => f !== page.mainFrame());
  await film.waitForFunction(() => Boolean(window.__strata && window.__pump), null, {
    timeout: 30000,
  });
  await page.evaluate(() => document.fonts.ready);
  await film.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  // Restart the film before the first frame. That skips the player's title
  // card, which would otherwise play out of frame while the screen is still on
  // the form, and raises the player's chrome, so the panel reads as a paused
  // film rather than an empty box.
  await film.evaluate(() => document.getElementById('restart').click());

  // A touch ring, so a tap reads as a tap rather than a button changing by
  // itself. Drawn from this script's clock, not from CSS, so it is frame-exact.
  await page.evaluate(() => {
    const layer = document.createElement('div');
    layer.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden';
    document.body.appendChild(layer);
    const rings = [];
    window.__tap = (x, y, t) => {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;width:78px;height:78px;margin:-39px 0 0 -39px;border-radius:50%;' +
        'border:2px solid rgba(146,226,231,.95);' +
        'background:radial-gradient(circle,rgba(146,226,231,.34),rgba(146,226,231,0) 68%)';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      layer.appendChild(el);
      rings.push({ el, t });
    };
    window.__tapFrame = (t) => {
      for (let i = rings.length - 1; i >= 0; i -= 1) {
        const age = t - rings[i].t;
        if (age > 0.62) {
          rings[i].el.remove();
          rings.splice(i, 1);
          continue;
        }
        const p = Math.max(0, age) / 0.62;
        rings[i].el.style.opacity = String(1 - p * p);
        rings[i].el.style.transform = `scale(${0.55 + p * 0.85})`;
      }
    };
  });

  // Where things are, measured rather than guessed.
  const geom = await page.evaluate(() => {
    const r = document.getElementById('frame').getBoundingClientRect();
    return {
      frameTop: r.top + scrollY,
      frameLeft: r.left,
      frameHeight: r.height,
      actionsTop: document.getElementById('actions').getBoundingClientRect().top + scrollY,
      cardsTop: document.querySelector('.cards').getBoundingClientRect().top + scrollY,
      docHeight: document.body.scrollHeight,
    };
  });
  const maxScroll = geom.docHeight - VIEW.height;
  // The film box is shorter than the screen, so it is parked near the top and
  // scrolled from the inside: that is where the section, the transport and the
  // readouts all live.
  const FILM_TOP = Math.min(maxScroll, geom.frameTop - 58);
  const FILM_PEEK = Math.max(0, geom.frameTop - 620);
  const ACTIONS = Math.min(maxScroll, geom.actionsTop - 470);
  const CARDS_1 = Math.min(maxScroll, geom.cardsTop - 90);
  // Offsets inside the film, measured off the player's own layout.
  const IN = { section: 210, done: 430, stats: 470, ticker: 770, legend: 1010 };
  log(`film at ${Math.round(geom.frameTop)}, top ${Math.round(FILM_TOP)}, max ${maxScroll}`);

  /** Centre of an element inside the film iframe, in screen coordinates. */
  const filmPoint = async (selector) => {
    const frameBox = await page.evaluate(() => {
      const r = document.getElementById('frame').getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    const box = await film.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
    return { x: frameBox.left + box.x, y: frameBox.top + box.y };
  };
  /** Centre of an element on the page itself, in screen coordinates. */
  const pagePoint = async (selector) => {
    const r = await page.locator(selector).boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };

  // ---- the timeline -------------------------------------------------------
  // Each beat owns a stretch of seconds and sets the two scroll positions for
  // the frame it is handed. Taps fire once, on the frame that passes their
  // moment. Times are in seconds of finished video.
  let pageY = 0;
  let filmY = 0;
  const fired = new Set();
  const once = async (key, at, t, fn) => {
    if (t < at || fired.has(key)) return;
    fired.add(key);
    await fn();
  };
  /** Press something, and show a touch ring where the thumb went. */
  const tap = async (selector, vt, inFilm) => {
    const p = inFilm ? await filmPoint(selector) : await pagePoint(selector);
    await page.evaluate(([x, y, t]) => window.__tap(x, y, t), [p.x, p.y, vt]);
    const target = inFilm ? film : page;
    await target.evaluate((sel) => document.querySelector(sel).click(), selector);
  };

  const beats = [
    {
      // The first screen: the name, and the field that takes any repository.
      name: 'open',
      until: 3.6,
      async at(t) {
        pageY = leg(t, 0.4, 3.2, 0, FILM_PEEK);
      },
    },
    {
      // The film takes the screen as its title card clears.
      name: 'film',
      until: 8.6,
      async at(t) {
        pageY = leg(t, 0, 2.4, FILM_PEEK, FILM_TOP);
        filmY = leg(t, 2.4, 4.2, 0, IN.section);
      },
    },
    {
      // Section and transport together: this is the shot that has to land.
      name: 'controls',
      until: 13.6,
      async at(t, vt) {
        filmY = IN.section;
        await once('speed2', 2.4, t, () => tap('[data-speed="2"]', vt, true));
      },
    },
    {
      // The readouts: the date under the playhead, and what is alive at it.
      name: 'stats',
      until: 18.6,
      async at(t) {
        filmY = leg(t, 0.4, 2.6, IN.section, IN.stats);
      },
    },
    {
      // The commit under the playhead, named, with the files it touched.
      name: 'ticker',
      until: 22.6,
      async at(t) {
        filmY = leg(t, 0.2, 2.2, IN.stats, IN.ticker);
      },
    },
    {
      // Which region of the tree each band is, and how much of it is alive.
      name: 'legend',
      until: 26.6,
      async at(t) {
        filmY = leg(t, 0.2, 2.2, IN.ticker, IN.legend);
      },
    },
    {
      // Back to the section, at speed, for the last stretch, then the totals
      // the run finished on.
      name: 'finish',
      until: 33,
      async at(t, vt) {
        filmY = leg(t, 0, 1.2, IN.legend, IN.section, easeOut);
        if (t > 2.8) filmY = leg(t, 3.4, 4.7, IN.section, IN.done);
        await once('speed4', 1.2, t, () => tap('[data-speed="4"]', vt, true));
      },
    },
    {
      // What you leave with: the page, the data, the link.
      name: 'actions',
      until: 38.8,
      async at(t, vt) {
        pageY = leg(t, 0.3, 2.6, FILM_TOP, ACTIONS);
        await once('copy', 3.2, t, () => tap('#copyLink', vt, false));
      },
    },
    {
      // How to run it yourself, and how to keep it current.
      name: 'cards',
      until: 45.6,
      async at(t) {
        pageY = leg(t, 0.2, 2.8, ACTIONS, CARDS_1);
        if (t > 2.8) pageY = leg(t, 3, 6.2, CARDS_1, maxScroll);
      },
    },
  ];

  const total = beats[beats.length - 1].until;
  const frames = Math.round(total * FPS);
  log(`${total}s at ${FPS}fps = ${frames} frames, ${VIEW.width * SCALE}x${VIEW.height * SCALE}`);

  // ---- encode -------------------------------------------------------------
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const ffmpeg = spawn(
    FFMPEG,
    [
      '-y', '-f', 'image2pipe', '-c:v', 'png', '-r', String(FPS), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-r', String(FPS), outPath,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );
  let ffErr = '';
  ffmpeg.stderr.on('data', (d) => {
    ffErr += d.toString();
  });
  const encoded = new Promise((resolve, reject) => {
    ffmpeg.on('error', (e) => reject(new Error(`could not run ffmpeg (${e.message})`)));
    ffmpeg.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}):\n${ffErr.slice(-1200)}`))
    );
  });
  const write = (buf) =>
    ffmpeg.stdin.write(buf) ? Promise.resolve() : new Promise((r) => ffmpeg.stdin.once('drain', r));

  const started = Date.now();
  let lastClock = 0;
  let beatIndex = 0;
  let beatStart = 0;
  for (let f = 0; f < frames; f += 1) {
    const vt = f / FPS;
    while (beatIndex < beats.length - 1 && vt >= beats[beatIndex].until) {
      beatStart = beats[beatIndex].until;
      beatIndex += 1;
    }
    await beats[beatIndex].at(vt - beatStart, vt);

    await page.evaluate(
      ([py, fy, t]) => {
        window.scrollTo({ top: py, behavior: 'instant' });
        window.__tapFrame(t);
      },
      [pageY, filmY, vt]
    );
    // The film's clock starts a beat late, so its title card plays as the
    // section scrolls into view rather than off screen above it. It is pumped
    // in steps of at most a 30th of a second, which is the largest step the
    // player will take in one frame, so a preview at a lower frame rate still
    // deposits at the same rate as the real thing.
    const filmClock = Math.max(0, vt - FILM_START) * 1000;
    await film.evaluate(
      ([fy, from, to]) => {
        window.scrollTo({ top: fy, behavior: 'instant' });
        for (let ts = from + 33.34; ts < to; ts += 33.34) window.__pump(ts);
        window.__pump(to);
      },
      [filmY, lastClock, filmClock]
    );
    lastClock = filmClock;

    await write(await page.screenshot({ type: 'png' }));
    if (f % (FPS * 2) === 0) {
      const done = f / frames || 0.0001;
      const eta = ((Date.now() - started) / done) * (1 - done);
      log(
        `  ${beats[beatIndex].name} — frame ${f}/${frames}, ${Math.round(eta / 1000)}s left`
      );
    }
  }
  ffmpeg.stdin.end();
  await encoded;

  log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB)`);
  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
