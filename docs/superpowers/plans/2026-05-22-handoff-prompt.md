# Handoff prompt — paste into a new chat

Copy everything in the fenced block below into the new chat session.
The prompt points the new agent at the full plan file and sets the
mission/constraints up front.

---

```
I'm continuing work on the Game Boy Camera picture extractor — a
TypeScript pipeline that turns a phone photo of a GBA SP showing a
GB Camera image into the clean 128×112 four-colour image the GBA SP
is actually rendering.

The previous session(s) made substantial progress on the warp step
and started on quantize/sample, but the warp has plateaued. The next
chunk of work is yours: finish fixing the warp (without using test
pixel diff as the signal — use the diagnostics we've built), then
move to the rest of the pipeline (correct, crop, sample, quantize),
then polish to bring the test pixel diff down. All without
hard-coding solutions to the seven specific sample/test images —
the pipeline needs to be robust across any phone photo of a GB
Camera screen.

Read these two files end-to-end before doing anything:

1. docs/superpowers/plans/2026-05-22-warp-rethink-and-pipeline.md
   — the handoff doc. Current state, what's been tried (works AND
   doesn't), available diagnostics, what's stuck, suggestions for
   directions worth thinking about, and operational notes (timeouts,
   pitfalls).

2. docs/superpowers/plans/2026-05-15-warp-knowledge-transfer.md
   — the much longer history. Round 6 has the user's verbatim
   visual feedback that's still load-bearing ground truth. Round
   8-12 has every iteration that did and didn't work, with reasoning.

Important context that should shape your approach:

- The last many iterations haven't really changed the warp much.
  Blotch count dropped from many to 5 real warp errors, all
  concentrated in 3 photos (165926, 165926~2-EDIT, 213443) that
  share a pattern: post-TPS perimeter is at canonical but the
  *interior* of the warp output drifts 2-3+ image-px in 15-25% of
  GB-pixel blocks. **Be willing to rethink the warp model itself.
  Nothing in the current pipeline is sacred — perspective + radial
  k1 + TPS may simply not be enough.** The handoff doc has several
  directions to consider.

- Don't fall into the parameter-tuning drift trap. Round 8 of the
  old plan explains it well: tuning hard-coded values (LAMBDA,
  CORNER_FRAC, contrast thresholds, peak-search widths) optimises
  for one image's feedback and re-breaks another. Algorithmic fixes
  derived from physics/optics/display geometry are the good
  pattern — the BGR sub-cell pre-blur work in the recent commits
  is a textbook example.

- The blotch-overlay debug image (<stem>_gbcam_blotches.png in the
  debug/ subfolder, generated automatically by pnpm test:pipeline)
  is the primary self-feedback signal for warp work. Anywhere a
  green ring shows up that's not legitimate camera content, the
  warp is shifting pixel content into a solid-colour band that
  shouldn't exist. A warp change that eliminates a blotch on one
  image AND doesn't introduce new blotches anywhere else is a win;
  anything that just shuffles them is not.

- Pipeline runs should take 5-7 min. NEVER let test:pipeline run
  longer than 15 minutes — kill it if so. The handoff doc explains
  one specific pitfall (cv.GaussianBlur with σ > ~30 is unusably
  slow) that already cost a 55-minute hang.

- For ambiguous cases, ask the user a focused question — not "what
  should I try next?" but "I see X on image Y; does that match what
  you see?" The user is the source of ground truth for what looks
  right; they redirected previous iterations effectively.

Goals, in priority order:

1. Get the warp right for all 7 sample images + 6 test images,
   measured by the diagnostic overlays and visual user feedback.
   Don't use test pixel diff as the warp signal.

2. Tune the rest of the pipeline (correct, sample, quantize) to
   match the now-correct warp. Same diagnostic-driven approach.

3. Polish: precise improvements to bring test pixel diff down.
   Test diff is appropriate as the signal only in this final phase.

Start by reading the two plan files, running `pnpm test:pipeline`
to regenerate the current state's diagnostics, and then forming a
hypothesis about which of the 5 remaining warp errors to attack
first. Don't start coding until you've looked at the actual
warp_e_border_detection.png and warp_c_detection_debug.png for at
least one of the three stubborn images (165926, 165926~2-EDIT,
213443) and understand what the warp is doing wrong.

You have full latitude to rewrite or replace any part of the
warp pipeline if a better approach makes more sense than what's
there. The user has explicitly said nothing is too sacred to
change.

DO NOT stop for confirmation; make your best calls and keep going.
The user will redirect via a separate message if needed.
```

---

That's the whole prompt. The text below is just notes for me (the
current chat) — not part of the prompt.

## Why a new plan file

The existing `2026-05-15-warp-knowledge-transfer.md` is ~1000 lines
of history. It's load-bearing for context — Round 6's user feedback
quotes specifically still matter — but it would be a poor *starting*
read for the next chat. The new `2026-05-22-warp-rethink-and-pipeline
.md` is ~300 lines focused on:

- Current measurable state (commit hashes, blotch counts, clamping
  ratios, test diff).
- Goals/constraints in order.
- A compact summary of what's been tried (good and bad).
- The diagnostic toolkit available.
- An honest "iteration is stuck" assessment so the next agent doesn't
  spend a session repeating incremental fixes on the same plateau.
- Specific re-think directions for the warp model + sample + quantize.
- Operational pitfalls (15-min timeout, GaussianBlur σ limit, blotch
  overlay as truth signal).

The new agent should read the new plan first for orientation, then
go back to the old plan for the verbatim Round 6 feedback log and
the detailed history.
