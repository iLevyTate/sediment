# sediment

**[ilevytate.github.io/sediment](https://ilevytate.github.io/sediment/)**

![Seventeen years of expressjs/express, drawn as sediment](assets/sediment.gif)

I wanted to see what my repository actually looked like over its whole life, and everything I found
gave me either a line chart or a swarm of dots I couldn't read. So I wrote this. It draws a git
history the way a road cut shows geology. Time runs left to right, each band is a region of the
tree, and the thickness of a band is how much code was alive at that moment. Grains fall on every
file a commit touches, sized by that file's line count. Deletions rise and drift off instead of
settling.

It works on any git repository, not only the one I built it for. The animation above is
`expressjs/express`: 6,158 commits, 390 contributors, June 2009 to July 2026, 209 files and 26,700
lines left standing at the end. You can put the same picture in your own README and have a workflow
keep it current.

## Running it

On a clone, with nothing installed:

```bash
npx sediment
```

That writes `.sediment/index.html`. Open it in a browser. The whole thing is one file with the data
baked in, so there is no server and no build step, and it still works with the network off. Add
`--video` for a 1080p mp4 and `--gif` for something small enough to embed. Recording needs
`playwright` and `ffmpeg` on your machine; the page and the datasets need neither.

One thing to watch. A shallow clone only contains the commits you fetched, so sediment can only draw
those. It checks and warns you before writing anything, but the fix is `git fetch --unshallow`
first, and on a big repository that takes a while.

Options worth knowing: `--out DIR` chooses where things land, `--json` writes the underlying
datasets alongside the page, `--lanes N` changes how many bands the section is split into, and
`--seconds N` sets how long the deposition runs in the video. `npx sediment --help` lists the rest.

## Keeping it current in your README

The action renders in CI and force-pushes the result to a branch, so a plain image link in your
README shows the repository as it is now rather than as it was the day you ran the command.

```yaml
name: sediment
on:
  schedule: [{ cron: '0 6 * * 1' }]
  workflow_dispatch:
permissions:
  contents: write
jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: iLevyTate/sediment@main
        with:
          video: 'true'
          gif: 'true'
          publish-branch: sediment
```

Then in your README:

```markdown
![History](https://raw.githubusercontent.com/OWNER/REPO/sediment/sediment.gif)
```

This repository does exactly that to itself, on every change to the action. The image below is not
committed anywhere; it is served from the `sediment` branch and replaced by the workflow, so it
shows this repository as of the last run.

![sediment's own history, rendered by its own action](https://raw.githubusercontent.com/iLevyTate/sediment/sediment/sediment.gif)

`fetch-depth: 0` is the part people miss. Without it the checkout is shallow and you get a film of
the last twenty commits. The branch also carries `sediment.mp4` and the interactive `index.html`, so
you can link those instead. Templates for the branch, PR-artifact and Pages variants are in
[`examples/`](examples).

## In the browser

The [hosted page](https://ilevytate.github.io/sediment/) takes a repository name and builds the film
client-side, which is the fastest way to look at somebody else's project. It opens on a prebuilt
example so there is something on screen before you type anything. Results are linkable:
`.../sediment/#owner/repo` rebuilds that repository.

## Why the numbers are right

This was the part I got wrong first, so it is worth explaining. My first version accumulated `+` and
`-` counts from `git log --numstat` and drifted about 1% over 1,400 commits, because renames lose
their base and merge commits are invisible to that view.

`git log --raw` carries the post-image blob SHA of every changed file. Sediment replays those blob
identities rather than adding up deltas, so the tree it holds after any commit is the real tree.
Every blob is line-counted exactly once through a batched `git cat-file --batch`, with NUL sniffing
so binaries score zero instead of garbage.

Merges are the remaining hole. `--raw` prints nothing for a merge commit, so content the merge
itself introduced, a conflict-resolved lockfile for instance, would never appear. Sediment anchors on
real `git ls-tree` snapshots, weekly plus every tag plus both endpoints, and reconciles its virtual
filesystem against them. On a 1,459-commit repository that is 53 anchors and 303 corrections.

I verify this rather than assert it. Against that repository the datasets reproduce the working tree
exactly: 1,822 of 1,822 files, 531,742 of 531,742 lines, zero per-file mismatches.

## What the hosted version gives up

The GitHub API will not hand out per-commit file lists without one request per commit, which for a
1,459-commit repository means 1,459 requests against an anonymous budget of 60 an hour. So the
browser build takes a different route. It reads the commit list at 100 per request, pulls the full
tree at about 26 anchor commits, and recovers file events by diffing consecutive trees. Those events
are real, they just belong to the window between two anchors rather than to an exact commit.

Two consequences, and the page states both. Sizes are file bytes rather than lines, because that is
what the tree API returns; binaries count as zero so a folder of icons cannot outrank the source
tree. And the whole thing costs about 43 requests for 1,459 commits, which fits inside the anonymous
limit. It asks `/rate_limit` first, that endpoint being free, then splits the budget between commit
pages and anchors. Where a repository does not fit, it fetches fewer commits and tells you, instead
of failing halfway through.

Run the CLI when you want the exact numbers.

## Lanes

A lane is a region of the tree that gets its own band. Sediment derives them from the repository's
own shape instead of asking you to describe it: group by top-level directory, split anything large
enough to be hiding structure, keep the biggest handful, sweep the tail into `other`. Sizing is by
lines, or non-binary bytes on the web, so an assets folder cannot outrank `src`.

On the repository I built this for, the derived lanes came out as `test`, `src/main`,
`src/renderer`, `docs`, `(root)`, `src/shared`, `scripts`, `test/e2e`, `test/components`, `ralph`,
`test/unit`, `other`, which is within one or two of the set I had hand-written earlier. Colours are
generated from a mineral ramp rather than fixed, so any lane count works. Lanes are path prefixes,
which means a file that existed only in 2019 and is long deleted still lands in one.

## The datasets

`--json` writes nine files next to the page.

| File                | Shape                   | Use it for                                           |
| ------------------- | ----------------------- | ---------------------------------------------------- |
| `meta.json`         | object                  | Totals, date range, lane list                        |
| `commits.json`      | array, chronological    | Commit-by-commit playback, running totals            |
| `file-events.json`  | columnar table          | Gource-style per-file animation                      |
| `daily.json`        | array, gap-filled daily | Growth curves, calendar heatmaps                     |
| `snapshots.json`    | array of tree snapshots | Animated treemaps, stacked areas, racing bars        |
| `files.json`        | array                   | File birth and death timelines, hotspot bubbles      |
| `contributors.json` | array                   | Contributor races, per-person lane mixes             |
| `releases.json`     | array of tags           | Milestone markers on any timeline                    |
| `derived.json`      | object                  | Hotspot and largest top-200, punchcard, busiest days |

`daily.json` is gap-filled on purpose. Quiet days are emitted with zero activity and the previous
day's totals carried forward, so a day-stepped animation advances at a constant rate without special
casing weekends.

## How the pieces fit

`src/extract.js` reads local git and `src/github.js` reads the API. Both produce the same datasets.
`buildPayload` compacts either one into a single payload and `buildHtml` inlines it into
`src/player.html`, which is the only renderer in the project. Because `buildPayload` and `buildHtml` are pure
and shared, the page the website hands you on **Download page** is byte-identical to the one the CLI
writes.

The site is the repository root: `index.html` importing from `src/`, with a `.nojekyll` beside it so
Pages serves the files as they are. No build step and no deploy workflow.

The demo payload is the largest thing the first screen waits for, so the page is laid out at its
final size before it is asked for: the film's box holds a drawn stratigraphic section from the first
paint, and dissolves into the real film once the frame has parsed. Every request that first screen
needs is declared in the head, and a visitor arriving at `#owner/name` never asks for the demo at
all.

## Limits

The video recorder has only been run on Linux, with Node 22 and ffmpeg 6.1. Nothing in it is
platform-specific and playwright covers the browser, but I have not tested Windows or macOS.

A GIF of a 30-second film runs 5 to 8 MB at 760 pixels wide. That is fine in a README and heavy
everywhere else, so the mp4 is the better artifact if you have somewhere to put it.

Repositories with tens of thousands of commits will work but the payload grows roughly linearly;
express at 6,158 commits produces a 739 KB page. I have not tried the Linux kernel and I do not
expect it to be pleasant.

The hosted page only reads public repositories. A token raises your rate limit, it does not grant
access to anything private, and it never leaves your browser except to GitHub.

MIT.
