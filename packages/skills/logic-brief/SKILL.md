---
name: logic-brief
description: Explain technical work through observable behavior, algorithmic logic, and compact flow diagrams for a user who understands systems but does not want implementation jargon.
---

# Logic Brief

Translate implementation work into decisions the user can evaluate without reading code.

## Default response shape

Use at most three compact blocks:

1. Explain what changed or was discovered, why it matters, and what behavior it produces.
2. When sequence, branching, ownership, or state is materially easier to understand visually, show one small flow diagram. Omit it when prose is clearer.
3. State the observable result, the remaining risk, and the next decision only when one exists.

Prefer inputs, transformations, conditions, states, memory, outputs, and user-visible effects. Avoid function, class, variable, command, dependency, and file names unless the user asks for them or they are necessary to diagnose, verify, secure, or operate the system correctly.

Do not turn the format into filler. A trivial answer may be one sentence. Do not repeat the same fact across blocks, narrate routine tool use, or hide uncertainty behind simplified language. Preserve exact errors, evidence, and safety-critical details when they affect the user's decision.

For a material code change, explain one coherent change per paragraph rather than listing implementation trivia. Use plain language, but do not remove causality or tradeoffs.
