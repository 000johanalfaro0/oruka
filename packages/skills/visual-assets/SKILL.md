---
name: visual-assets
description: Source, generate, or construct visual assets for a design while preserving provenance, cost boundaries, and consistency. Use when a website, interface, poster, deck, social piece, or motion project needs images, illustrations, icons, textures, or video.
---

# Visual Assets

Supply the visual material requested by a design brief without silently introducing paid services or cross-CLI orchestration.

## Resolve the need first

Define each needed asset by purpose, dimensions or aspect ratio, subject, art direction, required continuity, and acceptance criteria. Do not generate decoration before knowing its job in the composition.

Classify it before prompting: full-bleed scene, hero image, product capture, editorial image, illustration, character, texture, icon, or isolated transparent element. State whether it requires a background, alpha transparency, crop-safe empty space, or continuity with another asset. A small isolated element must not be prompted or framed like a complete scene.

Consume the active reference brief from `visual-reference-research`. Before generating original imagery, use `design-dna` to turn the selected references into explicit construction rules. Do not generate from loose adjectives or an undocumented moodboard. Reference images define visual principles; they do not grant reuse rights.

## Source order

Use the first suitable source:

1. User-approved brand and product assets.
2. Existing project assets and its design system.
3. For any newly generated image, the available Agy CLI/session using the active design DNA.
4. Codex ImageGen only when Agy is unavailable, lacks the required media capability, or returns a failed candidate after one evidence-backed retry.
5. Free or openly licensed sources the current environment can access.
6. Original SVG, CSS, canvas, diagram, or typographic construction.
7. An explicit placeholder or a request for a user choice.

Agy is the mandatory first generator for original imagery in this workflow. Route the design-DNA brief to the available Agy CLI/session and confirm that it exposes the required media capability before dispatch. Do not silently skip Agy. A fallback to Codex ImageGen is allowed only after recording `Agy unavailable | capability missing | generation failed after retry`, together with the evidence. Never use a paid provider, consume credits, create an account, or accept new terms without approval.

## Native capability routing

Inspect the tools actually available in Agy and the current session instead of assuming capability from the CLI name. When the brief requires generated imagery, feed Agy the active design DNA first. If the documented Agy fallback condition is met, use Codex ImageGen with the same DNA. Do not silently omit the asset, replace it with unrelated decoration, or claim it was generated. If no generator exists, continue down the source order and disclose the fallback.

Browser Harness is mandatory when searching external asset libraries, opening provenance or license pages, or inspecting an asset inside a browser-rendered composition. Do not replace it with Playwright, Chrome DevTools, generic web search, raw HTTP fetching, or a shell-launched browser. If Browser Harness is unavailable, stop that browser-dependent stage and report the missing capability.

For external free assets, record the direct source URL, creator when available, license or usage basis, and any transformations. Do not use search-result thumbnails as deliverable assets.

## Consistency and files

Every generation prompt must be traceable to the active design DNA: palette roles, composition ratios, lighting, lens or illustration language, texture, character/product continuity, exclusions, and the deliberate exception. Record which DNA rules each candidate implements. Generate the smallest useful number of candidates. Save selected assets under the project's existing convention with descriptive stable names; do not overwrite originals without approval.

Rank assets by narrative importance using size, placement, above-the-fold presence, semantic role, conversion relevance, and recurrence. Normally only the two or three strongest images become brand anchors. For those anchors, describe an approximate visual balance such as 70% base/neutral, 20% secondary brand color, and 10% accent when the approved DNA calls for it. Treat this as perceived visual weight, not a rigid pixel quota. Keep secondary assets quieter unless the composition provides a specific reason otherwise.

Prompts for generated anchors must be detailed enough to preserve the reference mechanism while changing niche and identity: job, subject, composition, camera or illustration viewpoint, hierarchy, lighting, material, texture, palette roles, color balance, background/alpha requirement, continuity, safe crop zones, exclusions, and the intended difference from the reference.

## Verification

Inspect the asset inside its real composition, not only in isolation. Check crop safety, legibility, contrast, responsive behavior, visual continuity, artifacts, factual correctness, and licensing/provenance. Feed failures back into `design-loop`; do not polish an asset that fails its purpose.

The handoff states which source path was used, files created, provenance, transformations, cost incurred (normally zero), and unresolved limitations.
