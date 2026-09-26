# The social clip

Two scripts that turn the hosted page into video for a social post: vertical
for phones, wide for everywhere else. Neither is part of the published package;
they only exist to re-render the clips when the page changes.

```bash
node tools/social/capture.mjs      # .social/screen.mp4 — the phone screen, 786x1704
node tools/social/compose.mjs      # .social/sediment-social.mp4 — 1080x1920, framed, with an end card

node tools/social/capture.mjs --cut short                    # .social/screen-short.mp4, ~20s
node tools/social/compose.mjs --screen .social/screen-short.mp4 \
  --out .social/sediment-shorts-1080x1920.mp4                # 23s, for YouTube Shorts
```

`--cut short` runs a second timeline: one speed tap rather than two, one pass
over the readouts, and a tail that stops on the `npx` line. The film still
deposits end to end, at 4×. `compose.mjs` shortens its end card to match
whenever the recording it is given is under thirty seconds, or take `--outro`
and `--fade` in seconds.

The wide version is the desktop page in a browser window with the phone in
front of its right edge, on 1920x1080:

```bash
node tools/social/capture.mjs --device desktop   # .social/screen-desktop.mp4 — 1440x900
node tools/social/capture.mjs                    # .social/screen.mp4, if not already recorded
node tools/social/compose.mjs --layout wide      # .social/sediment-wide-1920x1080.mp4
```

`--device desktop` records a 1440-wide browser with a mouse rather than a
thumb: a drawn pointer, with the real mouse moved to the same spot every frame
so hover states and the player's date hairline follow it. It runs on the long
cut's marks to the frame, so the two films deposit in step side by side and one
voiceover serves both shapes. `compose.mjs --layout wide` refuses a pair whose
lengths differ, since that means they were recorded from different cuts.

`capture.mjs` serves the repository on a local port, opens it at an iPhone
viewport, and records a scripted walkthrough of the demo film: the section
depositing, the transport, the readouts, the commit under the playhead, the
strata legend, then the actions and the cards. Nothing is sampled in real time.
The film's `requestAnimationFrame` is replaced by a pump this script calls once
per output frame and the scroll positions come from an eased timeline, so the
result is smooth and identical every run however slowly the machine
screenshots. It is the same idea as `src/record.js`, applied to the whole page
rather than to the player alone.

Both scripts need `playwright` and `ffmpeg`. Where those are not on the default
paths, point at them:

```bash
SEDIMENT_PLAYWRIGHT=/usr/lib/node_modules/playwright/index.mjs \
SEDIMENT_FFMPEG=/usr/bin/ffmpeg \
node tools/social/capture.mjs
```

`SEDIMENT_SOCIAL_FPS=6` records a rough preview in about a minute; the film
deposits at the same rate, so the framing is honest even though the motion is
not. Web fonts are fetched once into `tools/social/.fonts` and served from
there, so the typography is right on a machine with no route to Google Fonts.

Timings live in the `beats` array in `capture.mjs`. Each beat owns a stretch of
seconds and sets the page scroll, the scroll inside the film, and any taps.
