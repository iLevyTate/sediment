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
const PORT = 8771;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};

/**
 * `phone` is an iPhone 14 Pro at 2x, touch and all. `desktop` is a 1440-wide
 * browser at 1x with a mouse, recorded against the long cut's clock so the two
 * can share a frame and deposit in step.
 */
const DEVICE = flag('device', 'phone') === 'desktop' ? 'desktop' : 'phone';
const DEVICES = {
  phone: { viewport: { width: 393, height: 852 }, scale: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, scale: 1 },
};
const VIEW = DEVICES[DEVICE].viewport;
const SCALE = DEVICES[DEVICE].scale;
// Seconds of video before the film's own clock starts, per cut. The long cut
// holds on the first screen for a moment; the short one cannot afford to.
const FILM_START = { long: 1, short: 0.2 };

/** `long` is the 47-second cut; `short` is the ~23-second one for Shorts. */
const CUT = flag('cut', 'long') === 'short' ? 'short' : 'long';
if (DEVICE === 'desktop' && CUT === 'short') {
  console.error('the desktop recording only has a long cut; drop --cut short');
  process.exit(1);
}
const DEFAULT_OUT = {
  'phone/long': '.social/screen.mp4',
  'phone/short': '.social/screen-short.mp4',
  'desktop/long': '.social/screen-desktop.mp4',
}[`${DEVICE}/${CUT}`];
const outPath = path.resolve(flag('out', path.join(ROOT, DEFAULT_OUT)));

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
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    permissions: ['clipboard-read', 'clipboard-write'],
    ...(DEVICE === 'phone'
      ? {
          isMobile: true,
          hasTouch: true,
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
            '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        }
      : {}),
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
  // itself, and on the desktop a pointer to make it. Both are drawn from this
  // script's clock, not from CSS, so they are frame-exact.
  await page.evaluate(
    (ring) => {
      const layer = document.createElement('div');
      layer.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden';
      document.body.appendChild(layer);
      const pointer = document.createElement('div');
      pointer.style.cssText =
        'position:absolute;left:0;top:0;width:22px;height:30px;opacity:0;' +
        'filter:drop-shadow(0 2px 3px rgba(0,0,0,.55))';
      pointer.innerHTML =
        '<svg viewBox="0 0 22 30" width="22" height="30"><path d="M2 2v22l6-5.5 4 9 3.6-1.6' +
        '-4-8.9H20z" fill="#f4f6fa" stroke="#0b0e12" stroke-width="1.6" ' +
        'stroke-linejoin="round"/></svg>';
      layer.appendChild(pointer);
      window.__pointer = (x, y, alpha) => {
        pointer.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
        pointer.style.opacity = String(alpha);
      };
      const rings = [];
      window.__tap = (x, y, t) => {
        const el = document.createElement('div');
        el.style.cssText =
          `position:absolute;width:${ring}px;height:${ring}px;` +
          `margin:-${ring / 2}px 0 0 -${ring / 2}px;border-radius:50%;` +
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
    },
    DEVICE === 'phone' ? 78 : 44
  );

  // Where things are, measured rather than guessed.
  const geom = await page.evaluate(() => {
    const r = document.getElementById('frame').getBoundingClientRect();
    return {
      frameTop: r.top + scrollY,
      frameLeft: r.left,
      frameHeight: r.height,
      actionsTop: document.getElementById('actions').getBoundingClientRect().top + scrollY,
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
  // Far enough that the npx card is the thing on screen, and nothing else.
  const CARD_NPX = Math.min(maxScroll, geom.actionsTop + 150);
  // Offsets inside the film, measured off the player's own layout.
  const IN = { section: 210, done: 430, stats: 470, ticker: 770, legend: 1010 };
  // On the desktop the whole instrument fits on screen at once, so the page
  // parks once and only the legend needs the film scrolled to be read whole.
  const D_FILM = Math.min(maxScroll, geom.frameTop - 40);
  const D_ACTIONS = Math.min(maxScroll, geom.actionsTop - 620);
  const D_LEGEND = 190;
  log(`${DEVICE} ${CUT} cut — film at ${Math.round(geom.frameTop)}, max scroll ${maxScroll}`);

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
  /** Box of an element inside the film iframe, in screen coordinates. */
  const filmRect = async (selector) => {
    const c = await filmPoint(selector);
    const { w, h } = await film.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { w: r.width, h: r.height };
    }, selector);
    return { x: c.x - w / 2, y: c.y - h / 2, w, h };
  };
  const toPage = (y) => page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  const toFilm = (y) => film.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);

  // Where the pointer goes, measured once at the scroll positions it will be
  // used at, so a glide can start before the thing it is gliding to is pressed.
  let SPOT = null;
  if (DEVICE === 'desktop') {
    await toPage(D_FILM);
    const two = await filmPoint('[data-speed="2"]');
    const four = await filmPoint('[data-speed="4"]');
    const section = await filmRect('#section');
    const ticker = await filmPoint('#tickerSubject');
    await toFilm(D_LEGEND);
    const legend = await filmRect('#legend');
    await toFilm(0);
    await toPage(D_ACTIONS);
    const copy = await pagePoint('#copyLink');
    await toPage(0);
    const across = (fx, fy) => ({ x: section.x + section.w * fx, y: section.y + section.h * fy });
    SPOT = {
      offstage: { x: VIEW.width + 60, y: VIEW.height - 60 },
      rest: { x: section.x + section.w - 30, y: section.y + section.h + 150 },
      two,
      four,
      sweepFrom: across(0.14, 0.62),
      sweepTo: across(0.9, 0.5),
      ticker: { x: ticker.x + 40, y: ticker.y + 4 },
      legend: { x: legend.x + 70, y: legend.y + legend.h * 0.58 },
      aside: { x: ticker.x + 90, y: ticker.y + 70 },
      copy,
    };
  }

  // ---- the timeline -------------------------------------------------------
  // Each beat owns a stretch of seconds and sets the two scroll positions for
  // the frame it is handed. Taps fire once, on the frame that passes their
  // moment. Times are in seconds of finished video.
  let pageY = 0;
  let filmY = 0;
  // Desktop only: where the drawn pointer is, and how visible. The real mouse
  // is moved to the same place, so hover states and the player's hairline
  // follow it exactly.
  let pointer = { x: -60, y: -60, a: 0 };
  const glide = (t, t0, t1, a, b) => ({
    x: leg(t, t0, t1, a.x, b.x),
    y: leg(t, t0, t1, a.y, b.y),
  });
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

  const longCut = [
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
      // What you leave with: the page, the data, the link. Short: the film is
      // the reason to watch, and this end of the page is all type.
      name: 'actions',
      until: 37.4,
      async at(t, vt) {
        pageY = leg(t, 0.2, 2.2, FILM_TOP, ACTIONS);
        await once('copy', 2.4, t, () => tap('#copyLink', vt, false));
      },
    },
    {
      // How to run it yourself, and how to keep it current: one pass, no stop.
      name: 'cards',
      until: 41.4,
      async at(t) {
        pageY = leg(t, 0, 3.6, ACTIONS, maxScroll - 40);
      },
    },
  ];

  // The short cut keeps the film and drops everything the film does not need:
  // one speed tap instead of two, one pass over the readouts, and a tail that
  // stops on the command rather than touring the page. The deposition still
  // runs end to end, at 4x, because that is the thing worth watching.
  const shortCut = [
    {
      name: 'open',
      until: 2.2,
      async at(t) {
        pageY = leg(t, 0.3, 2.2, 0, FILM_PEEK);
      },
    },
    {
      name: 'film',
      until: 5,
      async at(t) {
        pageY = leg(t, 0, 1.8, FILM_PEEK, FILM_TOP);
        filmY = leg(t, 1.2, 2.6, 0, IN.section);
      },
    },
    {
      // One tap, and it runs the whole seventeen years from here.
      name: 'controls',
      until: 8,
      async at(t, vt) {
        filmY = IN.section;
        await once('speed4', 0.6, t, () => tap('[data-speed="4"]', vt, true));
      },
    },
    {
      // At 4x the counters move fast enough to read as motion, not as numbers.
      name: 'stats',
      until: 11,
      async at(t) {
        filmY = leg(t, 0.2, 1.8, IN.section, IN.stats);
      },
    },
    {
      name: 'legend',
      until: 13.2,
      async at(t) {
        filmY = leg(t, 0, 1.8, IN.stats, IN.legend);
      },
    },
    {
      // Back for the last stretch, the end card and the totals it lands on.
      name: 'finish',
      until: 17.4,
      async at(t) {
        filmY = leg(t, 0, 1.1, IN.legend, IN.section, easeOut);
        if (t > 2.6) filmY = leg(t, 2.8, 3.8, IN.section, IN.done);
      },
    },
    {
      // Stop on the command. Nothing after it is worth two seconds here.
      name: 'tail',
      until: 19.8,
      async at(t) {
        pageY = leg(t, 0, 2, FILM_TOP, CARD_NPX);
      },
    },
  ];

  // The desktop cut keeps the long cut's marks to the frame: 2x at 0:11.0, 4x
  // at 0:27.8, Copy link at 0:35.4, 41.4s in all. So the two recordings can
  // share a frame with their films depositing in step, and share one
  // voiceover. What changes is what fills each beat: a mouse instead of a
  // thumb, and the hover hairline the phone has no way to show.
  const desktopCut = [
    {
      name: 'open',
      until: 3.6,
      async at(t) {
        pageY = leg(t, 0.5, 3.4, 0, D_FILM);
      },
    },
    {
      // The instrument, whole: section, readouts, commit, transport.
      name: 'film',
      until: 8.6,
      async at(t) {
        pageY = D_FILM;
        pointer = { ...glide(t, 1.6, 4, SPOT.offstage, SPOT.rest), a: leg(t, 1.4, 2, 0, 1) };
      },
    },
    {
      name: 'controls',
      until: 13.6,
      async at(t, vt) {
        pointer = { ...glide(t, 0.3, 2.1, SPOT.rest, SPOT.two), a: 1 };
        await once('speed2', 2.4, t, () => tap('[data-speed="2"]', vt, true));
        if (t > 3.2) pointer = { ...glide(t, 3.4, 4.9, SPOT.two, SPOT.sweepFrom), a: 1 };
      },
    },
    {
      // Across the section: the hairline reads the date under the pointer.
      name: 'stats',
      until: 18.6,
      async at(t) {
        pointer = { ...glide(t, 0.2, 4.6, SPOT.sweepFrom, SPOT.sweepTo), a: 1 };
      },
    },
    {
      name: 'ticker',
      until: 22.6,
      async at(t) {
        pointer = { ...glide(t, 0.3, 1.8, SPOT.sweepTo, SPOT.ticker), a: 1 };
      },
    },
    {
      name: 'legend',
      until: 26.6,
      async at(t) {
        filmY = leg(t, 0.2, 1.8, 0, D_LEGEND);
        pointer = { ...glide(t, 0.4, 2, SPOT.ticker, SPOT.legend), a: 1 };
      },
    },
    {
      // Back up for the last stretch at 4x, then out of the way of the card.
      name: 'finish',
      until: 33,
      async at(t, vt) {
        filmY = leg(t, 0, 0.8, D_LEGEND, 0, easeOut);
        pointer = { ...glide(t, 0.1, 1, SPOT.legend, SPOT.four), a: 1 };
        await once('speed4', 1.2, t, () => tap('[data-speed="4"]', vt, true));
        if (t > 2.4) pointer = { ...glide(t, 2.6, 3.8, SPOT.four, SPOT.aside), a: 1 };
      },
    },
    {
      name: 'actions',
      until: 37.4,
      async at(t, vt) {
        pageY = leg(t, 0.2, 1.8, D_FILM, D_ACTIONS);
        pointer = { ...glide(t, 0.6, 2.2, SPOT.aside, SPOT.copy), a: 1 };
        await once('copy', 2.4, t, () => tap('#copyLink', vt, false));
      },
    },
    {
      name: 'cards',
      until: 41.4,
      async at(t) {
        pageY = leg(t, 0, 3.4, D_ACTIONS, maxScroll);
        pointer = { ...SPOT.copy, a: leg(t, 0.4, 1, 1, 0) };
      },
    },
  ];

  const beats = DEVICE === 'desktop' ? desktopCut : CUT === 'short' ? shortCut : longCut;

  const total = beats[beats.length - 1].until;
  const frames = Math.round(total * FPS);
  log(`${total}s at ${FPS}fps = ${frames} frames, ${VIEW.width * SCALE}x${VIEW.height * SCALE}`);

  // ---- encode -------------------------------------------------------------
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const ffmpeg = spawn(
    FFMPEG,
    [
      '-y',
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      '-r',
      String(FPS),
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '16',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-r',
      String(FPS),
      outPath,
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
      ([py, t, px, pyy, pa]) => {
        window.scrollTo({ top: py, behavior: 'instant' });
        window.__tapFrame(t);
        window.__pointer(px, pyy, pa);
      },
      [pageY, vt, pointer.x, pointer.y, pointer.a]
    );
    // Before the film is pumped, so the hover it causes lands in this frame.
    if (DEVICE === 'desktop' && pointer.a > 0) await page.mouse.move(pointer.x, pointer.y);
    // The film's clock starts a beat late, so its title card plays as the
    // section scrolls into view rather than off screen above it. It is pumped
    // in steps of at most a 30th of a second, which is the largest step the
    // player will take in one frame, so a preview at a lower frame rate still
    // deposits at the same rate as the real thing.
    const filmClock = Math.max(0, vt - FILM_START[CUT]) * 1000;
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
      log(`  ${beats[beatIndex].name} — frame ${f}/${frames}, ${Math.round(eta / 1000)}s left`);
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
