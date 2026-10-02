# Implementation Roadmap

## Planning assumptions
Team of 4–6 senior engineers: 2 core/geometry (TS + Rust), 1–2 Angular/editor UX, 1 compiler/font, with QA automation and DevOps shared (~1 FTE combined), plus part-time product design. Estimates are calendar ranges for that team; they are not commitments until Phase 0 spikes complete. Phases overlap where dependencies allow.

**V1 GA estimate: 11–15 months.** Internal alpha (walking skeleton) ≈ month 3; external beta ≈ month 9.

## Release increments

| Increment | Contents | Audience |
|---|---|---|
| M1 Walking skeleton (end Phase 1) | Create project, primitives, transform, undo/redo, autosave, SVG export of one icon, CLI `compile` parity | Internal |
| M2 Alpha (end Phase 3) | Secure import, Beginner flow, set overview, SVG/sprite export, `.iconproj` save/open | Design partners |
| M3 Beta (end Phase 6) | Rules + batch, PNG/ICO, Expert Playground incl. Booleans and live SVG | Public beta |
| M4 V1 GA (end Phase 8) | Font export, CLI + MCP, hardening, performance, a11y audit | GA |

## Phase 0 — Foundations and risk retirement (6–8 weeks)
Monorepo, Nx boundaries, CI (unit, cross-engine Playwright, bundle-size, licence policy, SBOM), strict TS; `SCHEMAS.md` as TS + generated JSON Schemas; canonical serializer + quantization; migrations framework; pure command handlers, transactions, undo/redo; fixture corpus scaffolding; performance harness. **Spikes S-01…S-06.**
Exit: empty project create/save/load/migrate deterministically across Node + 3 engines; spike ADR notes recorded.

## Phase 1 — Vector core + walking skeleton (6–8 weeks)
Scene graph, programmatic SVG renderer, selection, transforms, primitives, paint/stroke, groups/layers, snapping/grid, bounds; IndexedDB repository, journal, Web Lock single-writer; **minimal SVG compiler + golden test; CLI `compile` for SVG.**
Exit: M1 — edit representative icons with reliable undo/redo; CLI and browser SVG outputs byte-identical.

## Phase 2 — Import and security (4–6 weeks, overlaps Phase 1 tail)
Worker XML parser, allowlist canonicalizer, `use` expansion, clip-path lossy conversion, diagnostics, originals preservation, provenance. Spike S-07.
Exit: malicious corpus blocked; normal corpus round-trips within declared fidelity.

## Phase 3 — Beginner product (6–8 weeks)
Project/set UX, style panel with capability matrix, starter library (licensed, provenance-tagged), naming, set overview, preview (sizes/themes), `.iconproj` save/open with File System Access adapter, durability UX, sprite export.
Exit: M2 — usability scenario empty project → 5 icons → SVG/sprite export without docs (5 of 6 test participants).

## Phase 4 — Rules and batch consistency (5–6 weeks)
Rule registry, diagnostics with locations, fix proposals as commands, `set.applyStyle` dry-run diff UI, atomic apply.
Exit: mixed test set normalized with explainable results; undo restores byte-identical project.

## Phase 5 — Raster compiler (4–5 weeks)
PNG, ICO, export profiles, manifests/hashes, export dialog. Spikes S-04 (if deferred), S-09.
Exit: golden + decode/re-import verification; cross-engine parity.

## Phase 6 — Expert Playground (8–10 weeks)
Numeric inspector, segment/node editing, Booleans (`IGeometryEngine`), outline-stroke command (`IOutlineEngine`), live SVG editor with ID-preserving reconciliation, command palette, validation dock.
Exit: M3 — Beginner→Expert→Beginner lossless; Boolean corpus passes or diagnoses.

## Phase 7 — Font Lab (6–8 weeks; outline engine work starts in Phase 0/6)
Outline stage in compiler, glyph table, PUA allocation persistence, metrics, ligatures with input glyphs, OTF/WOFF2 (+TTF if S-05 passed), CSS/demo, verification harness. Spike S-08.
Exit: generated fonts load in all three engines; glyph manifest matches project; raster IoU gate passes.

## Phase 8 — Automation and hardening (5–6 weeks)
CLI command set, SARIF output, MCP server (stdio) with confirmation policy, optional WebMCP flag (S-10); performance tuning to budgets; WCAG 2.2 AA audit; security review/pen-test of import and archive paths.
Exit: M4 — headless validate/compile produces identical artifacts to UI; all budgets met or waived by ADR.

## Phase 9 — Recipes and AI (post-V1)
Recipe schema/evaluator (quantized output), recipe editor, AI proposal gateway, schema validation, preview/apply.
Exit: parameter modification changes intended geometry only and is undoable.

## Later
Framework packages, offset/fillet on arbitrary paths ("Weight"/"Roundness" for filled icons), raster tracing, optical-size masters, animation, cloud (ASP.NET Core) sync/sharing, collaboration/review, plugin SDK, publishing, enterprise policy/CI service, optional desktop shell.

## Quality gates every phase
Unit + property tests for model/geometry/rules; malicious-input tests; golden compiler fixtures with cross-engine parity; journal replay tests; browser E2E for critical workflows; performance and bundle budgets; accessibility checks; no silent data loss.

## Top risks
| Risk | Mitigation |
|---|---|
| Boolean/outline robustness | Phase 0 spikes, conformance corpus, diagnose-don't-corrupt, Rust fallback |
| Font output compatibility | OTF/WOFF2 baseline; TTF gated; independent-reader + browser-load verification |
| Local data loss | Single writer, persist(), file save first-class, journal checksums |
| Scope creep in Expert tooling | Phase 6 limited to listed features; anything else → post-V1 backlog |
| Determinism regressions | Cross-engine parity gate on every PR touching core/compiler |
