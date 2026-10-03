# Implementation status

Phase 0 is in progress. The v4 engineering package remains the design authority.

## Implemented foundations

- pnpm 11 / Nx workspace with Node 24 and TypeScript 6.0. Tagged package dependencies are enforced by Nx ESLint in CI; a forbidden import probe was rejected.
- V1 project types, Draft 2020-12 JSON Schema generation, CSP-safe standalone validator, semantic checks, canonical serialization and half-even quantization.
- Pure ordered migration framework with final-schema validation and read-only opening of future-major project documents, including `.iconproj` containers. There is no historical production version to migrate yet.
- Pure project create/rename/design-system update, token upsert/remove and icon add/rename/remove handlers with revision checks and reversible structural patches. Icon and token patches address a single array entry or field to keep journals bounded; token removal checks references.
- Application dispatcher with dry-run, idempotency, revisioned undo/redo, structural patches persisted in the SHA-256 checksummed journal, replay, corrupt-tail reporting and defensive state copies. Replay fixtures cover 1, 200 and 5,000 commands.
- IndexedDB repository adapter with atomic revision-checked journal append, snapshot compaction and corrupt-tail truncation; browser-tested reload, two-tab Web Lock takeover and read-only revision announcements in Chromium.
- Persistent-storage status request, quota-error classification, deterministic `.iconproj` ZIP with SHA-256 project and original hashes, and native-file/download save adapter. Chromium passes a 2,000-icon snapshot and archive round trip.
- Pure `export-svg` primitive serializer with escaped accessibility text, canonical paint and path output, precision fallback for narrow closed segments, and a Node/Chromium golden hash. Archive extraction enforces path, entry count and byte limits before decompression.
- CI checks for frozen installation, generated-schema drift, typecheck, unit tests and a three-browser Playwright parity fixture.
- Chromium performance harness checks 500-icon validation, 100 simple SVG serializations and p95 single-icon apply/undo against documented budgets with the required 10% tolerance.

## Gates still open

- S-01: Node/Chromium parity passes for quantization, checksummed journal replay and one canonical SVG fixture; 2,000-run numeric property checks pass. Firefox, WebKit and the full golden corpus are pending. The CI job is configured to install all three browsers, but it has not run on a remote runner yet.
- S-02: Paper.js runs four rectangle Booleans plus coincident/touching cases in a DOM-free, canvas-free Chromium worker; inputs stay unchanged and the minified worker is below 120 KB gzip. `IGeometryEngine` converts output back to quantized canonical paths. Rectangle and one cubic-circle/rectangle fixture meet raster IoU ≥ 0.999 for all four operations against Canvas compositing. The broader curved/near-degenerate corpus, full diagnostics and other browsers remain pending, so the spike has not passed.
- S-03: no conformance suite has passed; the Rust/WASM outline engine is still absent.
- S-04: resvg WASM in a Chromium worker produces byte-identical PNGs to Node across nine fixed sizes from 16–512 px, with correct alpha for the fixture, a local 512 px render under 250 ms and a gzipped WASM below 1.5 MB. Other browsers and a broader image corpus remain pending, so the gate has not passed.
- S-05: a deterministic OTF/CFF fixture has `.notdef`, space, PUA cmap and ligatures with input glyphs. Fontkit parses and shapes it; Chromium builds byte-identical font data to Node, `FontFace` loads it and the fixture glyph reaches raster IoU ≥ 0.98. WOFF2, TTF/cu2qu, broader glyph cases, package metrics and other browsers remain pending, so the gate has not passed.
- S-06: Chromium append/reload, stale-write rejection, compaction, corrupt-tail recovery, two-tab takeover, revision announcements, 2,000-icon save/load, forced quota and interrupted-tab atomicity pass. Persistence-status and file-save adapters pass unit tests and mocked browser adapter checks. A deterministic fault during an in-flight transaction, real native picker/download behaviour, Safari install/non-install documentation and Firefox/WebKit checks are pending.
- Remaining Phase 0 work: rest of the command registry, multi-command gesture transactions, future production migration fixtures, component/variant SVG expansion, remaining repository durability features, other performance operations and the required spikes.

The roadmap blocks Phase 1 until S-01 through S-06 pass or recorded adapter swaps satisfy their gates.

## Resolved specification question

The user chose to add optional `mergeLayers` to font-profile options. Its default is `false`, so existing profiles retain the documented duotone export error. The OTF font-construction spike accepts already filled glyph paths; full font export, including stroke outlining and duotone handling, remains pending.
