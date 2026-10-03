# Implementation status

Phase 0 is in progress. The v4 engineering package remains the design authority.

## Implemented foundations

- pnpm 11 / Nx workspace with Node 24 and TypeScript 6.0. Tagged package dependencies are enforced by Nx ESLint in CI; a forbidden import probe was rejected.
- V1 project types, Draft 2020-12 JSON Schema generation, CSP-safe standalone validator, semantic checks, canonical serialization and half-even quantization.
- Pure project create/rename and icon add/rename/remove handlers with revision checks and reversible structural patches. Icon patches address a single array entry or field to keep journals bounded.
- Application dispatcher with dry-run, idempotency, revisioned undo/redo, structural patches persisted in the SHA-256 checksummed journal, replay, corrupt-tail reporting and defensive state copies. Replay fixtures cover 1, 200 and 5,000 commands.
- IndexedDB repository adapter with atomic revision-checked journal append, snapshot compaction and corrupt-tail truncation; browser-tested reload, two-tab Web Lock takeover and read-only revision announcements in Chromium.
- Persistent-storage status request, quota-error classification, deterministic `.iconproj` ZIP with SHA-256 project and original hashes, and native-file/download save adapter. Chromium passes a 2,000-icon snapshot and archive round trip.
- Pure `export-svg` primitive serializer with escaped accessibility text, canonical paint and path output, precision fallback for narrow closed segments, and a Node/Chromium golden hash. Archive extraction enforces path, entry count and byte limits before decompression.
- CI checks for frozen installation, generated-schema drift, typecheck, unit tests and a three-browser Playwright parity fixture.

## Gates still open

- S-01: Node/Chromium parity passes for quantization, checksummed journal replay and one canonical SVG fixture; 2,000-run numeric property checks pass. Firefox, WebKit and the full golden corpus are pending. The CI job is configured to install all three browsers, but it has not run on a remote runner yet.
- S-02 through S-05: no conformance suites have passed yet.
- S-06: Chromium append/reload, stale-write rejection, compaction, corrupt-tail recovery, two-tab takeover, revision announcements, 2,000-icon save/load, forced quota and interrupted-tab atomicity pass. Persistence-status and file-save adapters pass unit tests and mocked browser adapter checks. A deterministic fault during an in-flight transaction, real native picker/download behaviour, Safari install/non-install documentation and Firefox/WebKit checks are pending.
- Remaining Phase 0 work: rest of the command registry, multi-command gesture transactions, migrations, component/variant SVG expansion, remaining repository durability features, performance harness and the required spikes.

The roadmap blocks Phase 1 until S-01 through S-06 pass or recorded adapter swaps satisfy their gates.

## Resolved specification question

The user chose to add optional `mergeLayers` to font-profile options. Its default is `false`, so existing profiles retain the documented duotone export error. The font compiler has not been implemented yet.
