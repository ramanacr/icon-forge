# Implementation status

Phase 0 is in progress. The v4 engineering package remains the design authority.

## Implemented foundations

- pnpm 11 / Nx workspace with Node 24 and TypeScript 6.0.
- V1 project types, Draft 2020-12 JSON Schema generation, CSP-safe standalone validator, semantic checks, canonical serialization and half-even quantization.
- Pure `project.create` and `project.rename` handlers with revision checks and reversible structural patches.
- Application dispatcher with dry-run, idempotency, SHA-256 checksummed journal, replay, corrupt-tail reporting and defensive state copies.
- CI checks for frozen installation, generated-schema drift, typecheck and tests.

## Gates still open

- S-01: Node/Chromium parity was observed for a small quantization fixture. Firefox, WebKit, full golden corpus and replay parity are pending.
- S-02 through S-06: no conformance suites have passed yet.
- Remaining Phase 0 work: full command registry, transactions, undo/redo, migrations, repository persistence, Nx dependency-boundary lint, performance harness and the required spikes.

The roadmap blocks Phase 1 until S-01 through S-06 pass or recorded adapter swaps satisfy their gates.

## Specification question

`specs/COMPILER_EXPORTS.md` allows a font profile to merge duotone layers, while normative `specs/SCHEMAS.md` has no `mergeLayers` option. The documented coding rules require architectural review rather than choosing between conflicting contracts.
