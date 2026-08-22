/**
 * The hosted front end: repository name in, film out.
 *
 * All the work happens in modules shared with the CLI. `fetchHistory` gathers
 * the datasets, `buildPayload` compacts them, `buildHtml` inlines them into the
 * player. The page you see in the frame is byte-identical to the one the
 * download button hands you, because it is the same string.
 *
 * The first screen is the one that has to be quick. Two things make it so: the
 * stage is laid out at its final size in the markup, so nothing moves when the
 * payload lands, and every request the first screen needs is in flight before
 * this module runs its first statement — the preloads in `index.html` start
 * them during head parsing, and the fetches below join those rather than
 * issuing new ones.
 */

import { fetchHistory, parseRepo, checkRate, planBudget } from './src/github.js';
import { buildPayload, buildHtml } from './src/payload.js';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'sediment.token';

/** A hash means the visitor asked for a specific repository, not the demo. */
const hashRepo = decodeURIComponent(location.hash.replace(/^#/, '')).trim();

// Both of these were preloaded in the head, so these calls attach to requests
// that are already on the wire. They are started together, at module scope, so
// the template is not waiting behind the payload the way it would if it were
// first asked for inside `present`.
const templatePromise = fetch(new URL('./src/player.html', import.meta.url)).then((r) => {
  if (!r.ok) throw new Error('could not load the player template');
  return r.text();
});
const demoPromise = hashRepo
  ? null
  : fetch(new URL('./demo.json', import.meta.url)).then((r) => (r.ok ? r.json() : null));

function status(text, bad = false) {
  const el = $('msg');
  el.textContent = text;
  el.className = bad ? 'bad' : '';
}
const progress = (pct) => {
  $('bar').style.width = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`;
};

/**
 * A bar for work whose size is not knowable in advance.
 *
 * The demo payload is served compressed, so the byte counts a stream reader
 * sees do not divide into any total the browser can report. Rather than print
 * a percentage that is quietly wrong, the bar eases toward — never reaching —
 * the end, and is closed out by whatever it was waiting on.
 * @param {number} [ceiling]
 * @returns {() => void} call to stop it
 */
function creep(ceiling = 0.9) {
  const started = performance.now();
  let raf = 0;
  const step = () => {
    const t = (performance.now() - started) / 1000;
    progress(ceiling * (1 - Math.exp(-t / 1.6)));
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/**
 * Put the placeholder section back and label it with what is coming.
 * @param {string} title @param {string} sub
 * @param {boolean} [failed] stills the animation — nothing is coming after all
 */
function settling(title, sub, failed = false) {
  $('skTitle').textContent = title;
  $('skSub').textContent = sub;
  $('film').classList.remove('ready');
  $('film').classList.toggle('failed', failed);
}

/** @param {() => void} fn */
const idle = (fn) =>
  'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(fn, 60);

/**
 * Dissolve the placeholder once the frame has something to show.
 *
 * Not on the frame's `load` event: that waits for its web fonts, and a visitor
 * behind a blocked or slow font CDN would sit staring at the placeholder for
 * as long as those take to give up — a film that has been drawn and is sitting
 * right behind it. The player draws during parse, so a parsed document is a
 * painted one. The frame is a blob of this origin, so its document is readable
 * from here; if some future browser disagrees, `load` is still the backstop.
 * @param {HTMLIFrameElement} frame @param {string} url the src it was given
 */
function revealWhenPainted(frame, url) {
  const done = () => {
    // A stale frame from an overtaken build must not raise the curtain.
    if (frame.src === url) $('film').classList.add('ready');
  };
  frame.addEventListener('load', done, { once: true });
  const poll = () => {
    if (frame.src !== url) return;
    let parsed = false;
    try {
      const doc = frame.contentDocument;
      parsed = !!doc && doc.URL === url && doc.readyState !== 'loading';
    } catch {
      return; // not readable, so leave it to the load event
    }
    if (parsed) requestAnimationFrame(done);
    else requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

/** Blob URLs back both the frame and the download, so they can never diverge. */
let objectUrls = [];
function freshUrl(text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  objectUrls.push(url);
  return url;
}

/**
 * Fill a download in after the frame has painted, not before.
 *
 * Serialising a payload again costs about as long as rendering the film does,
 * and most visitors never download anything. Doing it inline would hold the
 * reveal back for every visitor to serve the few who do, so it waits for the
 * main thread to go quiet. The click handler covers the sliver of time before
 * that happens: it builds the URL on the spot and replays the click.
 * @param {HTMLAnchorElement} a @param {() => string} text @param {string} type
 */
function deferDownload(a, text, type) {
  a.removeAttribute('href');
  const fill = () => {
    if (!a.getAttribute('href')) a.href = freshUrl(text(), type);
  };
  a.onclick = (e) => {
    if (a.getAttribute('href')) return; // already there; let the browser have it
    e.preventDefault();
    fill();
    a.click();
  };
  idle(fill);
}

// Restore a token the visitor pasted earlier. Storage can throw in private
// windows, so every access is guarded.
const savedToken = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return ''; // storage unavailable
  }
})();
if (savedToken) {
  $('token').value = savedToken;
  $('tokenBox').open = true;
}

/**
 * Put a payload on screen and behind the download buttons.
 *
 * The frame and the download are the same blob, so what gets saved is exactly
 * what is on screen.
 * @param {object} payload
 * @param {{scroll?: boolean}} [options]
 */
async function present(payload, options = {}) {
  const html = buildHtml(await templatePromise, payload);

  for (const u of objectUrls) URL.revokeObjectURL(u);
  objectUrls = [];
  const htmlUrl = freshUrl(html, 'text/html');
  const slug = payload.title.replace(/[^\w.-]+/g, '-');

  // Cross-fade to the film only once it has painted, so the placeholder is
  // never replaced by an empty frame.
  const frame = $('frame');
  frame.src = htmlUrl;
  revealWhenPainted(frame, htmlUrl);

  $('dlHtml').href = htmlUrl;
  $('dlHtml').download = `${slug}-sediment.html`;
  $('dlJson').download = `${slug}-sediment.json`;
  deferDownload($('dlJson'), () => JSON.stringify(payload), 'application/json');
  $('actions').hidden = false;
  if (options.scroll) $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const m = payload.meta;
  $('summary').textContent =
    `${payload.title} · ${m.commits.toLocaleString()} commits · ` +
    `${m.contributors.toLocaleString()} contributors · ${m.spanDays.toLocaleString()} days`;
}

/**
 * Which build the frame is currently committed to.
 *
 * The demo is in flight from the moment the page loads, so a visitor who types
 * a repository straight away has a race on their hands. Every build takes a
 * ticket, and a result is only shown if its ticket is still the current one.
 */
let generation = 0;

/**
 * Render something real before anyone types anything.
 *
 * The demo payload ships with the site and was generated by the CLI, so it
 * costs no API requests, cannot be rate-limited, and carries exact line counts
 * rather than the byte sizes a live build has to settle for.
 */
async function showDemo() {
  const mine = generation;
  const stop = creep(0.85);
  try {
    const payload = await demoPromise;
    if (mine !== generation) return; // the visitor got in first
    if (!payload) throw new Error('no demo shipped');
    await present(payload);
    if (mine !== generation) return;
    $('demoNote').hidden = false;
    progress(1);
    status('Type any public repository above to build its history.');
  } catch {
    // Leave the placeholder standing rather than fading to an empty frame,
    // and stop it implying that something is still on its way.
    if (mine !== generation) return;
    progress(0);
    settling('Sediment', 'type a repository above to build one', true);
    status('Type any public repository above to build its history.');
  } finally {
    stop();
  }
}

async function build(input, token) {
  const parsed = parseRepo(input);
  if (!parsed) {
    status('That does not look like a repository. Try owner/name.', true);
    return;
  }
  const mine = (generation += 1);
  const name = `${parsed.owner}/${parsed.repo}`;

  $('go').disabled = true;
  $('demoNote').hidden = true;
  $('actions').hidden = true;
  settling(name, 'reading its history…');
  progress(0.02);
  status('Checking your request budget…');

  try {
    // Without a token GitHub allows 60 requests an hour per address, and a
    // mid-sized repository wants more than that. Ask first, then fetch only
    // what fits, rather than failing halfway through.
    const rate = await checkRate(token);
    const plan = planBudget(rate.remaining);
    if (rate.remaining < 6) {
      const mins = rate.reset
        ? Math.max(1, Math.ceil((rate.reset * 1000 - Date.now()) / 60000))
        : 0;
      status(
        `GitHub's rate limit is spent${mins ? `. It resets in about ${mins} min` : ''}. ` +
          'Add a token to lift it to 5,000 an hour.',
        true
      );
      $('tokenBox').open = true;
      $('go').disabled = false;
      settling(name, 'needs a token to read', true);
      progress(0);
      return;
    }
    $('rate').textContent = `${rate.remaining} of ${rate.limit} API requests left this hour`;
    status(`Reading ${name}…`);

    const { datasets, rateRemaining, truncated } = await fetchHistory({
      ...parsed,
      token,
      maxCommits: plan.maxCommits,
      anchors: plan.anchors,
      onProgress: (message, pct) => {
        if (mine !== generation) return;
        status(message);
        if (typeof pct === 'number') progress(0.05 + pct * 0.85);
      },
    });
    if (mine !== generation) return;

    progress(0.94);
    status('Building the film…');
    const payload = buildPayload(datasets);
    await present(payload, { scroll: true });
    if (mine !== generation) return;

    const commits = payload.meta.commits.toLocaleString();
    progress(1);
    status(
      truncated
        ? `Done. The most recent ${commits} commits, which is what the remaining request ` +
            `budget covered.${token ? '' : ' A token fetches the rest.'}`
        : `Done. ${commits} commits.`
    );
    if (rateRemaining !== null && rateRemaining !== undefined) {
      $('rate').textContent = `${rateRemaining} API requests left this hour`;
    }
    location.hash = name;
  } catch (err) {
    if (mine !== generation) return;
    progress(0);
    settling(name, 'could not be read', true);
    status(err.message || String(err), true);
  } finally {
    if (mine === generation) $('go').disabled = false;
  }
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const token = $('token').value.trim();
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  build($('repo').value, token);
});

for (const chip of document.querySelectorAll('[data-example]')) {
  chip.addEventListener('click', () => {
    $('repo').value = chip.dataset.example;
    $('form').requestSubmit();
  });
}

$('copyLink').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    status('Link copied.');
  } catch {
    status('Copy the address bar to share this.', true);
  }
});

// A repo in the hash makes every result shareable, and lets a README link
// straight to a specific repository's film.
if (hashRepo) {
  $('repo').value = hashRepo;
  build(hashRepo, savedToken);
} else {
  showDemo();
}
