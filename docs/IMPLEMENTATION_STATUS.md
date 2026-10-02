# Implementation status

Phase 0 is in progress. The v4 engineering package remains the design authority.

## Implemented foundations

- pnpm 11 / Nx workspace with Node 24 and TypeScript 6.0.
- V1 project types, Draft 2020-12 JSON Schema generation, CSP-safe standalone validator, semantic checks, canonical serialization and half-even quantization.
- Pure `project.create` and `project.rename` handlers with revision checks and reversible structural patches.
- Application dispatcher with dry-run, idempotency, revisioned undo/redo, structural patches persisted in the SHA-256 checksummed journal, replay, corrupt-tail reporting and defensive state copies. Replay fixtures cover 1, 200 and 5,000 commands.
- IndexedDB repository adapter with atomic revision-checked journal append and snapshot compaction; browser-tested reload and two-tab Web Lock takeover in Chromium.
- CI checks for frozen installation, generated-schema drift, typecheck, unit tests and a three-browser Playwright parity fixture.

## Gates still open

- S-01: Node/Chromium parity passes for quantization and a checksummed journal replay fixture; 2,000-run numeric property checks pass. Firefox, WebKit and the full golden corpus are pending. The CI job is configured to install all three browsers, but it has not run on a remote runner yet.
- S-02 through S-05: no conformance suites have passed yet.
- S-06: Chromium append/reload, stale-write rejection, compaction and two-tab takeover pass. Quota, crash-mid-write, storage persistence, file save and Firefox/WebKit checks are pending.
- Remaining Phase 0 work: full command registry, multi-command gesture transactions, migrations, remaining repository durability features, Nx dependency-boundary lint, performance harness and the required spikes.

The roadmap blocks Phase 1 until S-01 through S-06 pass or recorded adapter swaps satisfy their gates.

## Resolved specification question

The user chose to add optional `mergeLayers` to font-profile options. Its default is `false`, so existing profiles retain the documented duotone export error. The font compiler has not been implemented yet.
