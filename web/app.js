/**
 * The hosted front end: repository name in, film out.
 *
 * All the work happens in modules shared with the CLI — `fetchHistory` gathers
 * the datasets, `buildPayload` compacts them, `buildHtml` inlines them into the
 * player. The page you see in the frame is byte-identical to the one the
 * download button hands you, because it is the same string.
 */

import { fetchHistory, parseRepo } from "./lib/github.js";
import { buildPayload, buildHtml } from "./lib/payload.js";

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "sediment.token";

let templatePromise = null;
const playerTemplate = () => {
  if (!templatePromise) {
    templatePromise = fetch(new URL("./lib/player.html", import.meta.url)).then(
      (r) => {
        if (!r.ok) throw new Error("could not load the player template");
        return r.text();
      },
    );
  }
  return templatePromise;
};

function status(text, bad = false) {
  const el = $("msg");
  el.textContent = text;
  el.className = bad ? "bad" : "";
}
const progress = (pct) => {
  $("bar").style.width = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`;
};

/** Blob URLs back both the frame and the download, so they can never diverge. */
let objectUrls = [];
function freshUrl(text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  objectUrls.push(url);
  return url;
}

// Restore a token the visitor pasted earlier. Storage can throw in private
// windows, so every access is guarded.
try {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) $("token").value = saved;
} catch {
  /* storage unavailable */
}

async function build(input, token) {
  const parsed = parseRepo(input);
  if (!parsed) {
    status("That does not look like a repository. Try owner/name.", true);
    return;
  }

  $("go").disabled = true;
  progress(0.02);
  status(`Reading ${parsed.owner}/${parsed.repo}…`);

  try {
    const { datasets, rateRemaining, truncated } = await fetchHistory({
      ...parsed,
      token,
      onProgress: (m, pct) => {
        status(m);
        if (typeof pct === "number") progress(0.05 + pct * 0.85);
      },
    });

    progress(0.94);
    status("Building the film…");
    const payload = buildPayload(datasets);
    const html = buildHtml(await playerTemplate(), payload);

    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls = [];
    const htmlUrl = freshUrl(html, "text/html");
    const jsonUrl = freshUrl(JSON.stringify(payload), "application/json");
    const slug = `${parsed.owner}-${parsed.repo}`.replace(/[^\w.-]+/g, "-");

    $("frame").src = htmlUrl;
    $("dlHtml").href = htmlUrl;
    $("dlHtml").download = `${slug}-sediment.html`;
    $("dlJson").href = jsonUrl;
    $("dlJson").download = `${slug}-sediment.json`;
    $("stage").classList.add("on");
    $("stage").scrollIntoView({ behavior: "smooth", block: "start" });

    const m = datasets.meta;
    $("summary").textContent =
      `${m.commits.toLocaleString()} commits · ${m.contributors} contributors · ` +
      `${m.filesAlive.toLocaleString()} files · ${m.range.spanDays} days`;

    progress(1);
    status(
      truncated
        ? `Done — showing the most recent ${m.commits.toLocaleString()} commits.`
        : `Done — ${m.commits.toLocaleString()} commits.`,
    );
    if (rateRemaining !== null && rateRemaining !== undefined) {
      $("rate").textContent = `${rateRemaining} API requests left this hour`;
    }
    location.hash = `${parsed.owner}/${parsed.repo}`;
  } catch (err) {
    progress(0);
    status(err.message || String(err), true);
  } finally {
    $("go").disabled = false;
  }
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const token = $("token").value.trim();
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  build($("repo").value, token);
});

$("copyLink").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    status("Link copied.");
  } catch {
    status("Copy the address bar to share this.", true);
  }
});

// A repo in the hash makes every result shareable, and lets a README link
// straight to a specific repository's film.
function fromHash() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
  if (!hash) return;
  $("repo").value = hash;
  let token = "";
  try {
    token = localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    /* storage unavailable */
  }
  build(hash, token);
}
fromHash();
