---
name: design-dna
description: Extract measurable, reusable visual rules from an approved design and verify them by reconstruction. Use when a reference, interface, poster, deck, or motion piece should become a persistent design system or project skill.
---

# Design DNA

Convert a successful artifact into rules another session can reproduce without vague style labels.

Inspect actual screenshots, rendered pages, design files, or frames. For webpages and browser-rendered references, Browser Harness (`blop-browser` or the host's `browser-harness` MCP tools) is mandatory: open each source, maximize the physical Harness-owned window, verify the largest useful viewport, take a semantic snapshot, capture fresh visual evidence, and record its direct URL. Window maximization and viewport sizing are separate checks; a non-maximized visible window invalidates the extraction. Do not substitute Playwright, Chrome DevTools, generic web search, raw HTTP fetching, or a shell-launched browser. If Browser Harness is unavailable, stop the browser-dependent extraction and mark the DNA unverified. Preserve relationships and principles, not third-party logos, text, characters, or brand identity without authorization.

Extract evidence-backed ratios, color shares, typography relationships, grid and spacing rhythm, named layout families, media and motion rules, deliberate exceptions, refusals, and meaningful absences. Separate invariant identity rules from format adaptations and flexible implementation choices.

Separate three layers: the reference mechanisms that form the quality floor, the new brand's identity invariants, and deliberate improvements intended to beat the reference. An improvement is valid only when it strengthens comprehension, trust, conversion, accessibility, responsive behavior, or craft without erasing the recognizable design logic. Record the current `YYYY-MM` so future sessions know when the commercial bar was last verified.

For a web reference, derive DNA from the complete Browser Harness walkthrough rather than the hero alone. Record a scroll-state timeline (`entry -> transition -> settled state`) for sticky, reveal, parallax, ticker, pinned, carousel, and background-change behavior. Every dynamic section requires at least two same-viewport screenshots separated by time or interaction, with an explicit delta for position, opacity, scale, clipping, active state, and z-order; a single screenshot leaves its motion DNA unverified. Inventory the distinctive elements that make the reference recognizable and classify each as structural, interactive, atmospheric, or content-specific. The reconstruction must reproduce the structural and interactive principles—not merely its palette and typography—without copying protected brand assets or code.

Give each important rule a pass/fail condition or bounded tolerance. Prefer a compact `DESIGN-DNA.md`; add token or layout files only when a project will consume them.

Rebuild a representative artifact using only the documented DNA, then compare it with fresh source evidence at matching viewport and scroll checkpoints. Treat meaningful mismatches in composition, element density, distinctive devices, rhythm, or motion as missing, incorrect, or overly rigid rules and revise. If reconstruction is impossible, state the unverified limitation.

The handoff identifies invariants, permitted variation, refusals, named layouts, verification results, provenance, and unresolved ambiguity.
