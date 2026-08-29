---
name: design-loop
description: Take a visual goal and a specific real-world reference through teardown, fresh-context building, and three independent critics until the result beats the reference and clears a current paid-quality bar. Use for websites, interfaces, images, videos, motion pieces, decks, and flagship visual assets.
---

# Design Loop

The builder must never be the final judge. Run four phases in order: interview, preflight, teardown, loop. Do not build during phases 1–3.

## Phase 1 — Interview

Obtain exactly these three answers together, then wait. If the invocation already answers one, prefill it and ask the user to confirm rather than asking a redundant fourth question.

1. What are we building, how large or long is it, who is it for, and what paid outcome or level of value must it justify?
2. What specific page, video, document, or artifact already does this brilliantly? If none, say `skip`.
3. What files must we work from: design system, brand rules, product captures, script, existing draft, or assets?

Push once when the reference or buyer is vague. If the reference is skipped, use `visual-reference-research` to propose three concrete bars with one-line reasons and wait; if the user still does not choose, take the hardest relevant bar.

## Phase 2 — Preflight

Run checks and report one compact block:

- Open and render the primary reference now. A missing or blocked reference must be replaced.
- Confirm the target can be rendered: Browser Harness screenshots for web, a frame sequence or filmstrip for motion/video, page renders for documents, and direct inspection for still assets.
- Confirm required generation capabilities. For original imagery use `visual-assets` and its Agy-first route; Codex ImageGen is only a recorded fallback.
- Confirm input files exist. If no `design-system.md` exists, derive a provisional one from authorized brand/product evidence and mark it provisional.
- Name what works, what is missing, and which critic would be blind. Never continue silently with a blind critic.

For every web page, Browser Harness is mandatory. In visible runs physically maximize the Harness-owned window, then set and verify the largest useful viewport (1920×1080 on the current workstation). Keep navigation, snapshots, interactions, and captures inside Harness. If it is unavailable, the web craft pass cannot succeed.

## Phase 3 — Teardown

Observe the entire reference, not only its first frame, and write `bar.md` before building.

For web, traverse header to footer and inventory navigation, hero, product proof, unique devices, CTA pattern, transitions, surfaces, typography, interactions, responsive behavior, and footer resolution. Every dynamic section needs at least two same-viewport captures—entry/before and settled/after—separated by documented time or interaction. Inspect sticky, reveal, hover, parallax, carousel, ticker, pinned, and scroll-linked states when present.

For video or motion, detect scene cuts and sample frames around cuts and important motion. Record shot order, duration, pacing, transition type, direction, easing character, overlays, text behavior, continuity, audio relationship when relevant, and which frames carry the visual identity. Fast edits need adaptive sampling rather than a single fixed interval.

Write five to seven reference mechanisms that a critic can check by looking. Use ratios, counts, limits, directions, durations, density, hierarchy, or observable behavior; never adjectives such as “premium” or “clean” without a measurable consequence.

### Current paid-quality gate

Stamp `bar.md` with the current `YYYY-MM`. The named reference remains the primary floor, but taste and buyer expectations can age. Through Browser Harness, add a small contemporary set—normally two or three directly relevant examples current or still competitive in that month—and record what a paying buyer would reasonably expect now: completeness, responsive finish, product credibility, interaction quality, accessibility, performance cues, and conversion clarity. Do not chase trends unrelated to the goal.

When resuming a saved loop in a later calendar month, refresh the contemporary set and commercial expectations before accepting any previous craft verdict. The primary reference and approved identity remain stable unless the user changes them.

Define how ours can win. It may add a missing section, stronger proof, clearer narrative, better responsive behavior, or purposeful motion, but every addition must improve comprehension, trust, conversion, delight, or craft. More content, effects, or animation without a defensible job is a failure, not an upgrade.

Show `bar.md` to the user and wait for approval before building.

## Phase 4 — Loop

Split the goal into the smallest independently renderable pieces, normally three or four. Create `design-loop-progress.md` containing each piece, round count, current verdicts, largest gap, and gap history. Do not report token-cost guesses.

For each piece:

1. Start a builder in a fresh context with the goal, approved inputs, `design-system.md`, `bar.md`, relevant Design DNA, and the current largest gap only. The builder does not grade its own result.
2. Render the actual output and capture fresh evidence after every material change. Evaluate the result, never intention or code.
3. Start three independent critics in fresh contexts. Invocation of this skill authorizes local read-only critic contexts; it does not authorize paid external agents or external mutations. If the host cannot provide fresh contexts or isolated sessions, stop and identify the missing capability rather than self-grading.

### Critics

- **Brief critic:** receives the stated goal and rendered evidence only. Ignore aesthetics. `PASS` only when the piece performs its intended job completely.
- **System critic:** receives `design-system.md`, applicable Design DNA, and rendered evidence only. `PASS` only on objective adherence, including responsive and accessibility rules.
- **Craft critic:** receives `bar.md`, the reference renders, contemporary comparison renders, and our renders only—never code or builder rationale. Use the strongest available visual model. Compare blind where possible. `PASS` only when ours is the better result, contains no obvious template/generic residue, and looks worth paying for in the month stamped in `bar.md` at the intended commercial level.

Critics return only `PASS` or `FAIL`, evidence, and the single biggest gap. Praise is not useful. All three must pass in the same round. Any failure returns the largest root gap to a fresh builder round, updates progress and memory, re-renders, and starts three new critic contexts.

There is no fixed round count and the first render has no special status. Exit only when all three pass, the full responsive/temporal regression passes, and no critical defect remains—or when the user stops the run. Weekly limits and user checkpoints are the real brake. If the run stops without passing, label the artifact incomplete; never soften the gate or present it as a successful final delivery.

## Regression and memory

After every piece passes, run the complete artifact from beginning to end. Recheck desktop and mobile, all major transitions, each dynamic state, and the ending. For video, compare cuts, pacing, continuity, and representative frame sequences. A regression failure reopens the responsible piece.

Maintain project memory as `gap -> evidence -> attempted correction -> observed effect -> verdict`. Reuse causal lessons, but never expose builder history to a craft critic. The final handoff includes the artifact, selected assets and provenance, approved `bar.md`, Design DNA, progress/gap history, final verdict evidence, and unresolved limitations.
