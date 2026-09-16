# Voiceover and music for the social clip

Everything here is cut to `sediment-social-1080x1920.mp4` as it stands: **46.8
seconds**, 30 fps, 9:16, with a silent stereo track you replace. Timecodes are
from the first frame of that file. Re-render the clip and the timings move, so
re-read the beat sheet against whatever `tools/social/capture.mjs` last wrote.

## The cut

| In     | Out    | On screen                                                    | Room for VO     |
| ------ | ------ | ------------------------------------------------------------ | --------------- |
| 0:00   | 0:04.0 | Wordmark, the `owner/name` field, the example chips          | one line        |
| 0:04.0 | 0:09.0 | Film takes the screen, deposition starts                     | one line        |
| 0:09.0 | 0:14.0 | Section and transport; **2×** tapped at 0:11                 | one line        |
| 0:14.0 | 0:18.6 | Date, commits, lines, files, releases, added, deleted        | one line        |
| 0:18.6 | 0:22.6 | The commit under the playhead and the files it touched       | one line        |
| 0:22.6 | 0:26.6 | Strata legend, lines alive per band                          | one line        |
| 0:26.6 | 0:33.0 | **4×** tapped at 0:28, finishes on 27 Jul 2026               | the payoff line |
| 0:33.0 | 0:37.4 | Download page, download data, Copy link → ✓ Copied at 0:35.4 | one line        |
| 0:37.4 | 0:41.4 | The three cards pass: `npx`, the Action, host anywhere       | one line        |
| 0:41.4 | 0:42.2 | Dip to black                                                 | silent          |
| 0:42.2 | 0:46.8 | End card: wordmark, tagline, command, URL                    | closing line    |

Two moments are worth hitting with the music rather than the voice: the **4×**
tap at 0:28, and the section landing at 0:29.7 with its totals.

## The script

About 34 seconds of speech inside 41 seconds of picture, which is the right
density for something people watch with one thumb. Line numbers are the
utterance order for the Hume request below.

| #   | In     | Out    | Line                                                                   |
| --- | ------ | ------ | ---------------------------------------------------------------------- |
| 1   | 0:01.2 | 0:04.0 | Every commit a repository has ever taken.                              |
| 2   | 0:04.6 | 0:08.9 | Time runs left to right. Each band is a region of the tree.            |
| 3   | 0:09.6 | 0:13.8 | Its thickness is how much code was alive at that moment.               |
| 4   | 0:14.4 | 0:18.4 | Grains fall on every file a commit touches, sized by its lines.        |
| 5   | 0:18.9 | 0:22.3 | Deletions rise and drift off instead of settling.                      |
| 6   | 0:23.0 | 0:26.4 | The legend names each band, and what is still alive in it.             |
| 7   | 0:27.0 | 0:32.6 | Seventeen years of Express. Over six thousand commits. Twenty seconds. |
| 8   | 0:33.4 | 0:37.2 | Take the page, the data, or a link to it.                              |
| 9   | 0:37.8 | 0:41.2 | Run it on any repository with npx.                                     |
| 10  | 0:42.8 | 0:45.8 | Sediment. Link in the bio.                                             |

Alternative openers, if the platform decides in the first second — swap line 1
and leave everything else:

- _This is seventeen years of code, drawn as rock._
- _Your git history, as a cliff face._
- _Nobody can read a contribution graph. Try this instead._

Alternative closers for line 10:

- _Sediment. On GitHub._
- _Sediment — ilevytate dot github dot i-o slash sediment._ (spell it out like
  that in the text field, or it gets read as one word)

Keep the numbers in line 7 the same as the screen. If you re-render against a
different repository, the totals change and the line has to change with them.

## Hume

Verified against the Octave TTS docs: an utterance takes `text` (5,000
characters), `description` (1,000), `voice`, `speed` (default `1`, unstable
below 0.75 or above 1.5) and `trailing_silence` (seconds). Top level takes
`context`, `format`, `num_generations` (max 5), `split_utterances`,
`instant_mode`, `temperature` and `version`.

### Design the voice once, then reference it

This is the part that decides whether the ten lines sound like one person.
Design the voice, save it, and from then on `description` is _acting
instruction_ for that line, not a fresh voice.

**1. Design** — `POST /v0/tts`, `version: "1"` (voice design is a v1 feature),
no `voice`, `num_generations: 3` to audition:

```json
{
  "utterances": [
    {
      "text": "Every commit a repository has ever taken.",
      "description": "A narrator in their late thirties with a low, dry, unhurried voice. Neutral North American accent, slightly warm, no broadcast polish and no sales energy. Speaks like someone showing you a thing they built rather than selling it: measured, curious, a little understated. Even pacing, clear consonants, sentences that fall at the end. Never upspeak, never excited, no smile in the voice."
    }
  ],
  "num_generations": 3,
  "version": "1"
}
```

**2. Save** the take you like — `POST /v0/tts/voices` with the
`generation_id` from that response and a `name`:

```json
{ "generation_id": "<from step 1>", "name": "sediment-narrator" }
```

**3. Speak the script** — one request, all ten utterances, so prosody carries
across the lines instead of ten unrelated reads. `trailing_silence` does the
gaps for you, which means you can drop the whole file on the timeline and
nudge it once rather than placing ten clips:

```json
{
  "utterances": [
    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "Every commit a repository has ever taken.",
      "description": "Quiet and matter-of-fact, like opening a drawer. No build.",
      "speed": 0.95,
      "trailing_silence": 0.6
    },

    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "Time runs left to right. Each band is a region of the tree.",
      "description": "Explaining, not selling. A beat after 'right'.",
      "speed": 0.97,
      "trailing_silence": 0.7
    },

    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "Its thickness is how much code was alive at that moment.",
      "description": "Even and plain. Lean very slightly on 'alive'.",
      "speed": 0.97,
      "trailing_silence": 0.6
    },

    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "Grains fall on every file a commit touches, sized by its lines.",
      "description": "Light and quick, the way you'd point at something moving.",
      "speed": 1.0,
      "trailing_silence": 0.5
    },

    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "Deletions rise and drift off instead of settling.",
      "description": "Softer, almost an aside. Let 'drift off' trail.",
      "speed": 0.95,
      "trailing_silence": 0.7
    },

    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "The legend names each band, and what is still alive in it.",
      "description": "Matter-of-fact, slightly brisker than the line before.",
      "speed": 1.0,
      "trailing_silence": 0.6
    },

    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "Seventeen years of Express. Over six thousand commits. Twenty seconds.",
      "description": "Slow down. Three separate statements, a real pause between each. Land the last one and stop.",
      "speed": 0.9,
      "trailing_silence": 0.8
    },

    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "Take the page, the data, or a link to it.",
      "description": "Warmer, offering rather than listing.",
      "speed": 1.0,
      "trailing_silence": 0.6
    },

    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "Run it on any repository with en-pee-ex.",
      "description": "Practical and unhurried, like reading out a command.",
      "speed": 0.97,
      "trailing_silence": 1.6
    },

    {
      "voice": { "name": "sediment-narrator", "provider": "CUSTOM_VOICE" },
      "text": "Sediment. Link in the bio.",
      "description": "Quiet sign-off. Falling, final, no lift on the last word.",
      "speed": 0.95,
      "trailing_silence": 0.4
    }
  ],
  "format": { "type": "wav" },
  "split_utterances": false,
  "instant_mode": false,
  "version": "2"
}
```

Notes on that request:

- `instant_mode` defaults to `true` and wants `num_generations` of 1, so turn
  it off for a take you intend to keep or to audition several.
- `version: "2"` for the read, `version: "1"` for the design step above.
- `format: wav` — do the loudness work yourself, at the end, once.
- To audition a single line without losing the voice's momentum, send the
  preceding lines in `context.utterances`, or pass the previous
  `context.generation_id`.

### Things that trip the read up

- **Write numbers as words.** "6,158" and "27k" get read unpredictably; the
  script already says "over six thousand".
- **Write commands phonetically.** `npx` → "en-pee-ex". `iLevyTate` →
  "eye-levy-tate". A URL wants "dot" and "slash" spelled out.
- **No Markdown, no emoji, no tags** in `text` — it reads them.
- **Keep the acting instruction short and physical.** "Like opening a drawer"
  beats "in an authoritative yet approachable tone".
- Generate three takes of the whole script rather than three of each line. The
  best whole take beats the best ten fragments.

## Suno

Instrumental only — the VO is the vocal. Turn **Instrumental** on, use Custom
Mode, and put the structure in the lyrics box as meta tags; current models take
roughly 1,000 characters of style and 5,000 of lyrics, but the first ~200
characters of the style field carry most of the weight, so front-load them.

### Three directions

**A — geological, closest to what the film is doing**

```
slow cinematic ambient, deep sub-bass swells, granular tape texture, single felt piano notes, bowed double bass harmonics, wide reverb, no drums until halfway, patient, unhurried, documentary, 80 BPM, A minor
```

**B — minimal systems music, best under a fast read**

```
minimal systems music, interlocking marimba and vibraphone pulse, muted Rhodes arpeggio, layers entering one at a time, soft kick from the midpoint, warm analog tape, restrained and hopeful, 96 BPM, D dorian
```

**C — modern and technical, the safest for a dev audience**

```
dark minimal techno bed, deep pulsing sub, filtered analog arpeggio, tight rimshot, sidechained pad, one slow riser into a restrained lift, no big drop, clean and modern, 100 BPM, F minor
```

### Structure, in the lyrics box

```
[Intro] one sustained tone, no drums
[Verse] sparse pulse enters, texture only
[Build] layers stack one at a time, filter opens slowly
[Lift] full pad and pulse, still restrained
[Break] drop to sub and texture
[Outro] resolve on one held chord, no fade
```

### Exclude styles

```
vocals, vocal chops, cymbal crash, EDM drop, trap hi-hats, supersaw, orchestra hits, sound effects, fade out
```

### Cutting it to picture

Generate around two minutes and cut back — Suno will not land its sections on
your timecodes, so pick the take whose lift sits about two thirds in and trim
the head until it lands where you want. What you are aiming for:

| Picture       | Music                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| 0:00–0:09     | one tone, texture only; nothing that competes with line 1              |
| 0:09–0:27     | pulse underneath, flat and steady, no event                            |
| 0:27–0:30     | the lift — **4×** is tapped at 0:28 and the section finishes at 0:29.7 |
| 0:30–0:33     | hold the peak while the totals sit on screen                           |
| 0:33–0:41     | pull back to the pulse under lines 8 and 9                             |
| 0:41.4        | resolve into the dip to black                                          |
| 0:42.2–0:46.8 | one held chord under the end card; stop, do not fade                   |

## The mix

- Voice: high-pass at 80 Hz, de-ess, **−16 LUFS** integrated, −2 dBTP.
- Bed: **−20 LUFS** under the voice, up to −16 in the gaps.
- Duck 6–9 dB under the voice: 20 ms attack, ~400 ms release.
- Master: **−14 LUFS**, −1 dBTP. Instagram and TikTok normalise toward −14, so
  anything hotter just gets turned down with the dynamics already gone.

This does all of it in one pass and has been run against the actual file:

```bash
ffmpeg -i sediment-social-1080x1920.mp4 -i vo.wav -i music.wav \
  -filter_complex "\
[1:a]highpass=f=80,loudnorm=I=-16:TP=-2:LRA=9,aresample=48000,\
aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vo][k];\
[k]apad[key];\
[2:a]volume=-9dB,aformat=sample_fmts=fltp:channel_layouts=stereo[bed];\
[bed][key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[duck];\
[duck][vo]amix=inputs=2:duration=longest:dropout_transition=0,\
loudnorm=I=-14:TP=-1:LRA=11,aresample=48000[mix]" \
  -map 0:v -map "[mix]" -c:v copy -c:a aac -b:a 192k -shortest \
  sediment-social-scored.mp4
```

`vo.wav` is the Hume file as it comes, starting at 0:00 — the leading silence
is in `trailing_silence`, so it lines up. The `apad` is there because the
ducking stops when the sidechain input does, which would otherwise cut the
music at the end of the last word. `-c:v copy` means the picture is never
re-encoded.

## Captions

Most of the feed watches muted, so burn them in. This matches the script above:

```srt
1
00:00:01,200 --> 00:00:04,000
Every commit a repository has ever taken.

2
00:00:04,600 --> 00:00:08,900
Time runs left to right.
Each band is a region of the tree.

3
00:00:09,600 --> 00:00:13,800
Its thickness is how much code
was alive at that moment.

4
00:00:14,400 --> 00:00:18,400
Grains fall on every file a commit
touches, sized by its lines.

5
00:00:18,900 --> 00:00:22,300
Deletions rise and drift off
instead of settling.

6
00:00:23,000 --> 00:00:26,400
The legend names each band,
and what is still alive in it.

7
00:00:27,000 --> 00:00:32,600
Seventeen years of Express.
Over six thousand commits. Twenty seconds.

8
00:00:33,400 --> 00:00:37,200
Take the page, the data,
or a link to it.

9
00:00:37,800 --> 00:00:41,200
Run it on any repository with npx.

10
00:00:42,800 --> 00:00:45,800
Sediment. Link in the bio.
```

Keep them out of the bottom fifth of the frame, where the platform puts its own
furniture. The phone in the clip is already inset, so around y=1500 sits under
the device and clear of the UI.

## Before you post

- **Suno's commercial terms depend on the plan you generated on.** Check what
  yours grants before this goes anywhere with a link in it.
- **Do not clone a real person's voice** for the narrator, your own aside, and
  check Hume's terms for commercial use of a designed voice.
- Both are non-deterministic. Three to five takes, then choose; nothing here
  reproduces exactly from the same prompt.
