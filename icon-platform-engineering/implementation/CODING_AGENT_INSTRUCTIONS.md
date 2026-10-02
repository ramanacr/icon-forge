# Coding Agent Instructions

## Mission
Implement IconForge incrementally per the PRD, architecture, ADRs and `specs/SCHEMAS.md`. Optimize for correctness, editability, determinism, security and a small dependency surface — not feature count.

## Source of truth order
1. `specs/SCHEMAS.md` (model, envelope, registry)
2. ADRs
3. Other specs
4. PRD/UX
If two documents conflict, stop and report the conflict instead of choosing.

## Non-negotiable rules
1. Read the relevant spec/ADR before changing architecture.
2. Canonical state is never DOM state and never an export artifact.
3. All user-visible mutations go through typed commands via the application layer.
4. **Handlers are pure:** no `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`, I/O or global state. IDs/timestamps arrive in the envelope/payload.
5. **Quantize** every geometry output before commit using `project-model` utilities; never hand-round.
6. Transcendental math (`sin`, `cos`, `atan2`, `pow`, …) is forbidden in `compiler-*`, `rules` and `export-*` (lint rule enforces).
7. Every mutating command defines validation, inverse patches, undo test, replay test and malformed-payload test.
8. Beginner and Expert modes never fork data models.
9. Exporters are pure relative to project state; `compile.run` is a query.
10. Imported SVG/font/archive, pasted source, AI output and agent tool arguments are untrusted.
11. Never silently discard unsupported constructs (reject, preserve original, or report lossy conversion).
12. Never insert imported or user-provided markup into the live DOM; build DOM programmatically. No `innerHTML`, no `bypassSecurityTrust*`.
13. No backend dependency for anything that can run locally.
14. No custom font binary table serialization; wrap mature tooling (ADR-010).
15. Evaluate platform APIs and existing packages before adding dependencies; new runtime dependencies require licence-policy pass and a note in the PR.
16. No AI-generated executable code runs inside the editor.
17. Heavy work (> 16 ms expected) runs in a worker.

## Work sequence per feature
Analyze → write/update acceptance + property tests → smallest vertical slice → unit/security/parity/E2E → inspect generated artifacts → document behaviour/limits → update ADR if architecture changed.

## Definition of done
- Acceptance criteria satisfied; tests cover success, failure, undo/redo, replay and malformed input.
- Cross-engine parity green for anything touching model/commands/compiler.
- No `any` without a documented boundary reason; no new lint suppressions without justification.
- No console errors in supported browsers.
- Keyboard path and screen-reader labels verified for new UI.
- Serialization compatibility considered; migration added if schema changed.
- Performance measured against `BROWSER_AND_PERFORMANCE_BUDGETS.md` for batch/geometry/compiler changes.
- Bundle budget respected.
- Documentation updated.

## First milestone backlog (Phase 0 → M1)
1. Bootstrap workspace, Nx tags/boundaries, CI with cross-engine Playwright.
2. `project-model`: types, schema generation, quantization, canonical serializer, migration framework.
3. `commands` + `application`: dispatcher, transactions, inverse patches, history, revision checks, dry-run.
4. Replay harness (snapshot + journal ⇒ byte-identical).
5. Spikes S-01…S-06 with conformance suites committed.
6. Scene graph + programmatic SVG renderer.
7. Primitive create/select/transform commands with gesture→single-transaction commit.
8. Persistence: Dexie repository, journal compaction, Web Lock single writer.
9. Minimal Beginner shell.
10. Compile one icon to SVG in browser and CLI with matching golden hash.

## Stop conditions — request architectural review if a change requires
bypassing the application layer; impure handlers; writing export output back into source; executable recipe syntax; weakening SVG sanitization or archive limits; changing persisted schema without migration; adding a network dependency to edit/export; relaxing the CSP; or breaking cross-engine parity.
