# IconForge Phase 0 implementation plan

The v4 engineering package is the design authority. This plan implements the first vertical slice; Phase 1 is gated by executable evidence for S-01 through S-06.

## Workspace

- Add pnpm workspace and Nx with module-boundary tags for `project-model`, `commands`, and `application`.
- Pin Node 24 and exact dependency versions in a lockfile. Add CI for typecheck, unit tests, and browser parity.

## Canonical model and S-01

- Implement the `SCHEMAS.md` types and JSON Schema 2020-12 generation/validation without changing their documented fields.
- Implement round-half-even quantization, canonical number and JSON formatting, and stable content hashes.
- Add generated, redistributable fixtures for boundaries, negative zero, nested key order, and project round trips.
- Prove identical JSON and SVG hashes in Node, Chromium, Firefox, and WebKit before marking S-01 complete.

## Commands and application

- Implement pure command handlers, revision checks, idempotency, dry-run, and patch/inverse-patch transactions.
- Test malformed payload rejection, undo/redo, snapshot plus journal replay, and corrupt tail reporting.
- Persist snapshots and checksummed journal entries behind a repository interface.

## Remaining Phase 0 spikes

- S-02: worker-safe Boolean adapter with corpus and diagnostic fallback.
- S-03: Rust/WASM stroke outline adapter with cap/join and overlap corpus.
- S-04: resvg deterministic raster adapter.
- S-05: OTF/TTF font construction and independent-reader/browser verification.
- S-06: Dexie, Web Locks, file-save, and crash recovery scenarios.

Each spike commits its conformance tests and an ADR note. No Phase 1 claim is made until all six gates pass or their adapter swaps are recorded.
