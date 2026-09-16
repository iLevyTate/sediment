# Voiceover and music for the social clip

Everything here is cut to `sediment-social-1080x1920.mp4` as it stands: **46.8
seconds**, 30 fps, 9:16, with a silent stereo track you replace. Timecodes are
from the first frame of that file. Re-render the clip and the timings move, so
re-read the beat sheet against whatever `tools/social/capture.mjs` last wrote.

There is a second cut for YouTube Shorts — `sediment-shorts-1080x1920.mp4`,
**23.0 seconds**, from `capture.mjs --cut short`. Its own script and score are
at the end, under [The Shorts cut](#the-shorts-cut-230). Everything between
here and there is the long one.

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

## HUME

One block, in the order it is spoken. Pause markers are where the picture wants
air, not punctuation — line 5 lands on the section finishing, line 8 on the end
card. About 37 seconds of audio inside 46.8 of picture.

```
Every commit this repository has ever taken. [pause] Time runs left to right. Each band is a region of the tree, its thickness the code that was alive at that moment. [pause] Grains fall on every file a commit touches, sized by that file's lines. [pause] Deletions rise and drift off instead of settling. [long pause] Seventeen years of Express. [pause] Over six thousand commits. [pause] Twenty seconds. [long pause] Take the page, the data, or a link to it. [pause] Run it on any repository with en-pee-ex. [long pause] Sediment. Link in the bio.
```

Where each sentence lands, for placing the file on the timeline:

| #   | In     | Out    | Against                           |
| --- | ------ | ------ | --------------------------------- |
| 1   | 0:01.2 | 0:04.0 | the field and the example chips   |
| 2   | 0:04.7 | 0:13.2 | the film taking the screen        |
| 3   | 0:14.2 | 0:19.4 | the readouts ticking              |
| 4   | 0:19.9 | 0:23.2 | the commit under the playhead     |
| 5   | 0:27.0 | 0:32.0 | **4×**, and the section finishing |
| 6   | 0:33.5 | 0:37.2 | download page, data, Copy link    |
| 7   | 0:37.9 | 0:41.0 | the cards passing                 |
| 8   | 0:42.8 | 0:45.6 | the end card                      |

The legend beat, 0:23 to 0:27, is deliberately dry. The music carries it.

Alternative openers, if the platform decides in the first second — swap the
first sentence and leave the rest:

- _This is seventeen years of code, drawn as rock._
- _Your git history, as a cliff face._
- _Nobody can read a contribution graph. Try this instead._

Alternative closers:

- _Sediment. On GitHub._
- _Sediment — ilevytate dot github dot i-o slash sediment._

Write it the way it is spoken, not the way it is typed: "en-pee-ex" for `npx`,
"over six thousand" rather than "6,158", "dot" and "slash" in any URL. If you
re-render against a different repository, sentence 5 has to change with the
totals on screen.

## Sending it to Hume

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

**3. Speak the script** — one request, all eight utterances, so prosody
carries across them instead of eight unrelated reads. `trailing_silence`
holds the gaps the picture needs, including the dry stretch at 0:23 and the
dip to black before the end card, so the file drops on the timeline at 0:01.2
and needs no further placing:

```json
{
  "utterances": [
    {
      "voice": {
        "name": "sediment-narrator",
        "provider": "CUSTOM_VOICE"
      },
      "text": "Every commit this repository has ever taken.",
      "description": "Quiet and matter-of-fact, like opening a drawer. No build.",
      "speed": 0.95,
      "trailing_silence": 0.7
    },
    {
      "voice": {
        "name": "sediment-narrator",
        "provider": "CUSTOM_VOICE"
      },
      "text": "Time runs left to right. Each band is a region of the tree, its thickness the code that was alive at that moment.",
      "description": "Explaining, not selling. A beat after 'right'. Lean very slightly on 'alive'.",
      "speed": 0.97,
      "trailing_silence": 1.0
    },
    {
      "voice": {
        "name": "sediment-narrator",
        "provider": "CUSTOM_VOICE"
      },
      "text": "Grains fall on every file a commit touches, sized by that file's lines.",
      "description": "Light and quick, the way you'd point at something moving.",
      "speed": 1.0,
      "trailing_silence": 0.5
    },
    {
      "voice": {
        "name": "sediment-narrator",
        "provider": "CUSTOM_VOICE"
      },
      "text": "Deletions rise and drift off instead of settling.",
      "description": "Softer, almost an aside. Let 'drift off' trail.",
      "speed": 0.95,
      "trailing_silence": 3.8
    },
    {
      "voice": {
        "name": "sediment-narrator",
        "provider": "CUSTOM_VOICE"
      },
      "text": "Seventeen years of Express. Over six thousand commits. Twenty seconds.",
      "description": "Slow down. Three separate statements, a real pause between each. Land the last one and stop.",
      "speed": 0.9,
      "trailing_silence": 1.5
    },
    {
      "voice": {
        "name": "sediment-narrator",
        "provider": "CUSTOM_VOICE"
      },
      "text": "Take the page, the data, or a link to it.",
      "description": "Warmer, offering rather than listing.",
      "speed": 1.0,
      "trailing_silence": 0.7
    },
    {
      "voice": {
        "name": "sediment-narrator",
        "provider": "CUSTOM_VOICE"
      },
      "text": "Run it on any repository with en-pee-ex.",
      "description": "Practical and unhurried, like reading out a command.",
      "speed": 0.97,
      "trailing_silence": 1.8
    },
    {
      "voice": {
        "name": "sediment-narrator",
        "provider": "CUSTOM_VOICE"
      },
      "text": "Sediment. Link in the bio.",
      "description": "Quiet sign-off. Falling, final, no lift on the last word.",
      "speed": 0.95,
      "trailing_silence": 0.4
    }
  ],
  "format": {
    "type": "wav"
  },
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
- To audition one sentence without losing the voice's momentum, send the
  preceding ones in `context.utterances`, or pass the previous
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

## SUNO

Instrumental on, Custom Mode. Style prose in the style box, the timeline in the
lyrics box.

### Style

```
Slow geological ambient score, 80 BPM, forty-seven seconds, patient and documentary. Four elements only: a deep sub drone, a granular tape texture, single struck felt-piano notes, and a soft low pulse on the beat. No drum kit, no risers, no cymbals, one swell in the whole piece. Opens with room tone, the sub drone and one struck piano note. At nine seconds the pulse enters under the texture and holds flat, no event, a piano note landing every four bars. At twenty-two the texture widens and a second drone slides in a fifth below. At twenty-seven the pulse doubles and a slow low swell rises, peaking at thirty and holding to thirty-three. Then it pulls back to sub and pulse, the piano alone. At forty-one everything resolves onto one sustained low chord and the pulse stops dead. That chord holds alone, decaying into room tone, nothing after forty-seven seconds. Restrained, unhurried, never triumphant, never a trailer.
```

### Timeline

```
[80 BPM]
[Intro]
[0:00 room tone, deep sub drone, one struck felt-piano note]
[0:04 granular tape texture fades in beneath the drone]
[Verse]
[0:09 soft low pulse enters on the beat, level holds flat]
[0:14 second piano note, nothing else changes]
[0:18.5 texture thickens, pulse unchanged]
[0:22.5 drone widens, a second drone a fifth below slides underneath]
[Chorus]
[0:27 pulse doubles, slow low swell begins to rise]
[0:29.7 peak, the only lift in the piece]
[0:33 pull back to sub and pulse, swell gone]
[Bridge]
[0:37.5 piano alone over the sub, texture thins]
[Outro]
[0:41.4 resolve onto one sustained low chord, pulse stops dead]
[0:42.2 chord holds alone under the end card]
[0:45.5 chord begins to decay]
[0:46.8 out]
```

### Exclude styles

```
vocals, drum kit, cymbal crash, riser, EDM drop, supersaw, orchestra hits, sound effects, fade out
```

### Two other directions, same timeline

- **Minimal systems music** — swap the first sentence for _interlocking marimba
  and vibraphone pulse, muted Rhodes arpeggio, warm analog tape, 96 BPM, D
  dorian_, and let the layers enter one at a time on the same marks.
- **Dark minimal techno** — _deep pulsing sub, filtered analog arpeggio, tight
  rimshot, sidechained pad, 100 BPM, F minor_, with the 0:27 mark as a filter
  opening rather than a swell.

Suno will not land its sections on your timecodes. Generate two minutes, take
the version whose lift sits about two thirds in, and trim the head until 0:29.7
falls on the peak.

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

Most of the feed watches muted, so burn them in. This matches the block above:

```srt
1
00:00:01,200 --> 00:00:04,000
Every commit this repository
has ever taken.

2
00:00:04,700 --> 00:00:08,400
Time runs left to right.

3
00:00:08,500 --> 00:00:13,200
Each band is a region of the tree — its
thickness, the code alive at that moment.

4
00:00:14,200 --> 00:00:19,400
Grains fall on every file a commit
touches, sized by that file's lines.

5
00:00:19,900 --> 00:00:23,200
Deletions rise and drift off
instead of settling.

6
00:00:27,000 --> 00:00:32,000
Seventeen years of Express.
Over six thousand commits. Twenty seconds.

7
00:00:33,500 --> 00:00:37,200
Take the page, the data,
or a link to it.

8
00:00:37,900 --> 00:00:41,000
Run it on any repository with npx.

9
00:00:42,800 --> 00:00:45,600
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

## The Shorts cut (23.0)

Same recording tools, a tighter timeline: one speed tap instead of two, one
pass over the readouts, and a tail that stops on the command. The film still
deposits end to end — it runs at 4× from 0:05.6 and finishes at 0:15.6, which
is the whole point of the cut.

| In     | Out    | On screen                                      |
| ------ | ------ | ---------------------------------------------- |
| 0:00   | 0:02.2 | Wordmark, the field, the example chips         |
| 0:02.2 | 0:05.0 | Film takes the screen                          |
| 0:05.0 | 0:08.0 | Section and transport; **4×** tapped at 0:05.6 |
| 0:08.0 | 0:11.0 | Readouts, running at four times speed          |
| 0:11.0 | 0:13.2 | Strata legend                                  |
| 0:13.2 | 0:17.4 | Finishes on 27 Jul 2026, totals land           |
| 0:17.4 | 0:19.2 | `npx github:iLevyTate/sediment`                |
| 0:19.2 | 0:19.8 | Dip to black                                   |
| 0:19.8 | 0:23.0 | End card                                       |

### HUME

```
Every commit this repository has ever taken. [pause] Time runs left to right. Each band is a region of the tree, its thickness the code alive at that moment. [pause] Seventeen years of Express. [pause] Ten seconds. [long pause] Run it on any repository with en-pee-ex. [pause] Sediment. Link below.
```

Forty-four words, about twenty seconds with the pauses, starting at 0:00.8. Use
the same designed voice and the same acting instructions as the long cut; only
`trailing_silence` changes — 0.6, 0.7, 0.5, 1.4, 0.7, 0.4 in that order.

"Ten seconds" is load-bearing: in this cut the deposition really does run from
0:05.6 to 0:15.6. If you retime the beats, retime the line.

### SUNO

Style

```
Slow geological ambient score, 80 BPM, twenty-three seconds, patient and documentary. Three elements only: a deep sub drone, a granular tape texture and a soft low pulse on the beat, with single struck felt-piano notes over them. No drum kit, no risers, no cymbals, one swell in the whole piece. Opens with room tone, the sub drone and one struck piano note. At five seconds the pulse enters and doubles at once, holding flat and quick underneath. At thirteen the texture widens and a second drone slides in a fifth below. At fifteen a slow low swell peaks, the only lift in the piece, and holds to seventeen. Then it pulls back to sub and pulse. At nineteen everything resolves onto one sustained low chord and the pulse stops dead. That chord holds alone, decaying into room tone, nothing after twenty-three seconds. Restrained, unhurried, never triumphant, never a trailer.
```

Timeline

```
[80 BPM]
[Intro]
[0:00 room tone, deep sub drone, one struck felt-piano note]
[Verse]
[0:05.6 low pulse enters and doubles at once, flat and quick]
[0:09 second piano note, nothing else changes]
[0:13 drone widens, a second drone a fifth below slides underneath]
[Chorus]
[0:15.6 slow low swell peaks, the only lift in the piece]
[0:17.4 pull back to sub and pulse, swell gone]
[Outro]
[0:19.2 resolve onto one sustained low chord, pulse stops dead]
[0:19.8 chord holds alone under the end card]
[0:22 chord begins to decay]
[0:23 out]
```

### Captions

```srt
1
00:00:00,800 --> 00:00:03,600
Every commit this repository
has ever taken.

2
00:00:04,200 --> 00:00:08,600
Time runs left to right.
Each band is a region of the tree.

3
00:00:08,700 --> 00:00:12,600
Its thickness, the code
alive at that moment.

4
00:00:13,600 --> 00:00:17,200
Seventeen years of Express.
Ten seconds.

5
00:00:17,800 --> 00:00:20,600
Run it on any repository with npx.

6
00:00:21,200 --> 00:00:22,800
Sediment. Link below.
```

The mix command earlier in this file works unchanged; point it at
`sediment-shorts-1080x1920.mp4`.
