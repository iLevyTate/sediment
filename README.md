# sediment

**[Try it in your browser →](https://ilevytate.github.io/sediment/)**

Turn a git repository's history into a stratigraphic film.

Time runs left to right. Each band is a region of the tree; its thickness is the code alive at that
moment. Grains fall on every file event, sized by the file and coloured by where it lives —
deletions rise and dissipate instead of settling. Release tags mark themselves as the playhead
reaches them, and the whole section is scrubbable.

Works on any repository. Nothing to configure: the bands are derived from your own directory
layout.

## Three ways to use it

### 1. Locally, for exact numbers

```bash
npx github:iLevyTate/sediment            # -> .sediment/index.html
npx github:iLevyTate/sediment --gif      # -> ...and an mp4 + gif
```

No dependencies for the page — it is one self-contained HTML file you can open, email, or drop on
your own site. Recording needs `ffmpeg` on `PATH` and `playwright` installed.

### 2. As a GitHub Action, so your README stays current

Copy [`examples/sediment.yml`](examples/sediment.yml) into `.github/workflows/`. It renders on every
push and once a week, then force-pushes the results to a `sediment` branch:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0 # sediment needs the whole history
- uses: iLevyTate/sediment@main
  with:
    gif: 'true'
    publish-branch: sediment
```

That gives you URLs that never go stale:

```md
![history](https://raw.githubusercontent.com/OWNER/REPO/sediment/sediment.gif)
```

The other two templates cover the common variations — [`sediment-pr.yml`](examples/sediment-pr.yml)
attaches a film to every pull request as a build artifact (nothing is committed), and
[`sediment-pages.yml`](examples/sediment-pages.yml) publishes to GitHub Pages so the interactive
version lives at a real URL you can iframe into a personal site.

Pin to a tag rather than `@main` once you care about reproducibility.

### 3. In the browser, with nothing installed

**<https://ilevytate.github.io/sediment/>**

Type a repository name and the film is built client-side against the GitHub API — useful for
looking at somebody else's repository without cloning it. **Download page** hands you the same
self-contained HTML the CLI writes, and every result is linkable: `…/sediment/#owner/repo` rebuilds
it.

It checks your remaining API budget before starting and fetches only what fits, so an anonymous
visit degrades to fewer commits rather than failing halfway. Pasting a token (kept in your browser,
never sent anywhere but GitHub) lifts the ceiling from 60 requests an hour to 5,000.

## Why the local version is the accurate one

`git log --raw` carries the post-image blob SHA of every changed file, so the replay tracks _blob
identity_ rather than accumulating `+`/`-` deltas — the per-commit tree never drifts. Every blob is
line-counted exactly once through a batched `git cat-file --batch`, with NUL-sniffing to score
binaries at zero.

`--raw` shows nothing for merge commits, so content introduced by a merge itself (conflict-resolved
lockfiles, evil merges) would be invisible. Periodic `git ls-tree` anchors reconcile the virtual
filesystem against ground truth to catch it.

The result is checkable, and it checks out: on a 1,459-commit repository the datasets reproduce the
working tree exactly — 1,822 of 1,822 files and 531,742 of 531,742 lines, with no per-file
mismatches.

The browser version cannot do this. Per-commit file lists are one API request _per commit_, so it
takes a different route: the commit list, plus the tree at ~26 anchor commits, plus file events
recovered by diffing consecutive trees. That is real data — those files genuinely changed in that
window — but sizes are **bytes** rather than lines (binaries score zero), and events land at anchor
granularity. The page says so. A 1,459-commit repository costs about 43 requests, which fits inside
the unauthenticated limit of 60 per hour; a token raises it to 5,000.

## Lanes

A lane is a region of the tree with its own band. They are derived from the repository, not
configured: group by top-level directory, split any group big enough to be hiding structure, keep
the largest handful, sweep the tail into `other`. Sizing is by lines (or non-binary bytes) so a
folder of icons cannot outrank the source tree.

For this project's own reference repository that yields `test, src/main, src/renderer, docs, (root),
src/shared, scripts, test/e2e, test/components, ralph, test/unit, other` — close to what you would
choose by hand. `--lanes N` changes the cap.

Because lanes are path _prefixes_, a file that existed only in the distant past still lands in a
lane by longest-prefix match.

## Options

```
--repo PATH         repository to read (default: .)
--out DIR           output directory (default: .sediment)
--video             also record an mp4
--gif               also write a gif (implies --video)
--seconds N         deposition length in the video (default 30)
--fps N             frames per second (default 30)
--width N           video width (default 1920)
--height N          video height (default 1080)
--theme dark|light  video theme (default dark)
--hold N            seconds on the closing card (default 3)
--lanes N           maximum bands (default 12)
--snapshot-days N   days between tree snapshots (default 7)
--json              also write the full datasets as JSON
```

`sediment web-assets --out _site` assembles the hosted front end.

## The data

`--json` writes the datasets behind the film, if you would rather build your own thing with them:
`commits`, a columnar `file-events` table, gap-filled `daily` rollups, per-anchor `snapshots`,
per-file `files` lifespans, `contributors`, `releases`, and a `derived` bundle with hotspots and a
punchcard. They are keyed by a shared commit index, so they join cleanly.

`buildPayload` compacts them into what the player reads; `buildHtml` inlines that into the template.
Both are pure and shared by the CLI and the browser, so an exported page is byte-identical to a
generated one.

## Recording

The recorder opens the page at `#film`, which drops the live-viewer chrome and reflows to 16:9, then
advances the animation through `window.__strata.step(1/fps)` — a fixed slice of _video_ time per
frame rather than wall-clock. The output does not depend on how fast the machine can screenshot, and
since the grain simulation runs on a seeded PRNG, the same command produces the same video every
time. Frames pipe straight into ffmpeg; nothing is staged on disk.

## Notes

- **The full history is required.** `actions/checkout` defaults to depth 1; use `fetch-depth: 0`.
  The CLI warns when it sees a shallow clone, and the action unshallows for you.
- The page is theme-aware and works with no network — the webfont is loaded off the critical path,
  so an exported file opens fine offline.
- Layout in the readout is fixed rather than content-sized, so nothing shifts as commits stream past.

## License

MIT.
