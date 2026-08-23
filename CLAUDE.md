# sediment

Turns a git repository's history into a stratigraphic film. `src/` holds the
shared modules, `bin/sediment.js` the CLI, `src/player.html` the only renderer,
`index.html` plus `app.js` the hosted page, `action.yml` the GitHub Action.
`test/github-fixture.mjs` exercises the API path without the network, and
`npx prettier --check .` must pass before anything ships.

## Writing style

These rules apply to every piece of prose in this project: README, UI copy,
CLI messages, code comments, commit messages, PR bodies, release notes, and
anything drafted for the maintainer to publish elsewhere. Two scoping notes
from applying them across the codebase: a dash used as an empty-value marker
in a numeric readout is data, not punctuation, and the CSS `transform`
property is code, not the banned word.

You are writing prose that a specific person wrote, not text that an
assistant produced. Follow these rules.

### Write like this

Vary sentence length hard. Put a 34-word sentence next to a 5-word one. If
three sentences in a row land in the 15 to 20 word range, break one.

Commit to a position. Say the thing you actually think, in the first
paragraph, without hedging it into vapor. If two sides genuinely deserve
weight, give them weight; if one side is weak, say it's weak.

Use specifics that could be checked. Real numbers, real names, real dates,
real versions, real dollar amounts. If you don't have a specific, don't
invent a fake one and don't paper over the gap with an abstraction. Say you
don't have it, or leave the claim out.

Let the structure follow the argument. Some sections run long because they
need to. Some are two sentences. Sections do not need to be the same size,
and they do not need parallel subheadings.

Prefer paragraphs to bullets. Use a list only when the items are genuinely
parallel and order-independent. Never use a list of exactly three when you
have two real points and a filler.

Allow rough edges: an aside, a qualification mid-thought, an unresolved
question at the end, a word choice that's slightly off-register but right.
Do not tie everything off.

End when the argument ends. No summary of what was just said. No
"ultimately." No forward-looking uplift about the future being bright.

### Never do this

Structural bans, in priority order:

1. No em dashes or en dashes. Use a comma, a period, a colon, or
   restructure. This is absolute.
2. No "not just X, it's Y" and no variants: "isn't about X, it's about Y,"
   "more than X, it's Y."
3. No participial tails. Ban sentences ending in "..., ensuring X,"
   "..., allowing Y," "..., making it easier to Z," "..., helping teams W."
4. No paragraph-initial transition glue. Cut Moreover, Furthermore,
   Additionally, In conclusion, That said, It's worth noting, It's
   important to remember.
5. No restating the question before answering it.
6. No rule-of-three padding. Two adjectives, or four, or one. Not three by
   reflex.
7. No bolded label followed by a colon at the head of every bullet.
8. No vague attribution. "Studies show," "experts agree," "research
   suggests" are banned unless you name the study.
9. No placeholder people. No "imagine a small business owner named Sarah."
10. No politeness scaffolding. No "great question," no "I hope this helps,"
    no unprompted caveats.

Word-level bans: delve, tapestry, realm, landscape (figurative), testament,
underscore, navigate (figurative), foster, harness, leverage (verb), robust,
seamless, intricate, nuanced, multifaceted, meticulous, pivotal, crucial,
vital, comprehensive, unlock, elevate, supercharge, transform, revolutionize,
empower, streamline, cutting-edge, game-changing, in today's fast-paced
world, in an era of.

Do not swap a banned word for its nearest synonym. Rewrite the sentence so
the word isn't needed.

### Self-audit before you output

Run this pass on your own draft and fix what it catches. Do not show the
audit.

- Count sentence lengths. If the standard deviation looks flat, rewrite
  three sentences to break the rhythm.
- Search for every banned construction above. Each hit gets a structural
  rewrite, not a synonym.
- Find every claim with no verifiable specific attached. Either add the
  specific or cut the claim.
- Check whether every section is roughly the same length. If so, that
  symmetry is artificial. Collapse or expand.
- Read the last paragraph. If it summarizes rather than advances, delete it
  and end on the previous one.
- Ask: could this have been written by anyone, about anything? If yes, it
  has no author. Put one back in.
