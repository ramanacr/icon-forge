# Architecture Decision Records

Status values: Accepted · Amended · Superseded · Proposed.

## ADR-001 — Canonical model, not SVG files, is project source
Accepted. SVG is an interchange/compiled format. Variants, components, provenance, recipes and rules exceed SVG's project semantics.

## ADR-002 — Beginner and Expert modes share one document/engine
Accepted. Modes change presentation and exposed controls only.

## ADR-003 — Central command layer
Accepted. UI, AI, CLI, MCP, WebMCP and REST adapters invoke the same commands/queries through the application layer.

## ADR-004 — Local-first V1
Accepted. Core editor and compiler operate offline; cloud is optional.

## ADR-005 — SVG DOM interactive renderer for V1
Accepted. Canvas/WebGL is an optimization path for thumbnails only.

## ADR-006 — Deterministic rule engine before AI auto-fix
Accepted.

## ADR-007 — Icon Recipe is declarative and non-executable
Accepted.

## ADR-008 — Exporters are pure compiler stages
Accepted. `compile.run` is a query.

## ADR-009 — Third-party plugin runtime deferred beyond V1
Accepted.

## ADR-010 — Font tooling uses mature implementation
Accepted. Do not implement OpenType/WOFF2 binary internals from scratch. (Wrapping, glue and verification are ours; table serialization is not.)

## ADR-011 — Unsupported imports never silently degrade
Accepted. Reject, preserve original, or explicitly report lossy conversion.

## ADR-012 — AI is optional
Accepted.

## ADR-013 — Angular/TypeScript shell with framework-independent core
Accepted. Angular 22 + TypeScript 6.0 (Angular 22 constrains TS to `>=6.0 <6.1`). Zoneless change detection and OnPush/signal components are the default for new code.

## ADR-014 — Selective Rust/WebAssembly acceleration
Accepted. TypeScript is the default implementation language.

## ADR-015 — Adapter-based geometry engine
**Amended (v4).** Paper.js is the bootstrap `IGeometryEngine` for Booleans, contingent on spike S-02 proving headless operation in a Web Worker and acceptable results on the conformance corpus (coincident/touching edges, near-degenerate input). Failures must be diagnosed (`boolean.unsupported-geometry`), never silently wrong. Rejected as canonical engine: polygon-only clippers (e.g. Clipper2) because they flatten curves; CanvasKit/Skia PathOps because of bundle size. Rust/WASM candidates are evaluated against the same corpus; the winner replaces Paper.js without a model change.

## ADR-016 — Optional .NET 10 cloud service
Accepted. ASP.NET Core / .NET 10 (LTS) + PostgreSQL when cloud capabilities are introduced. The .NET layer handles identity, tenancy, sync, sharing, AI gateway and audit; it never re-implements geometry, rules or compilation (server-side compile runs the TS core).

## ADR-017 — pnpm + Nx monorepo
Accepted.

## ADR-018 — Quantized geometry and pure, replayable commands
Accepted (v4). Persisted coordinates are multiples of 0.001 viewBox units; handlers are pure and receive all IDs/timestamps/seeds in the envelope; transcendental math only in handlers; compiler uses arithmetic only.
*Why:* JS engines do not guarantee identical results for `Math.sin/cos/atan2/pow`; without this, CLI ≠ browser artifacts and journal replay produces different IDs.
*Cost:* sub-visible precision loss; adapters must pre-generate IDs (e.g. `icon.duplicate` carries an `idMap`).

## ADR-019 — Structured path representation
Accepted (v4). Paths are stored as absolute subpaths of `L/Q/C` segments; arcs convert to cubics at import (diagnosed). `d` strings exist only at import/export edges.
*Why:* exact diffing, segment-addressed editing, unambiguous quantization, no reparsing in hot paths.
*Cost:* larger JSON than `d` strings (~2–3×, mitigated by ZIP compression).

## ADR-020 — Single writer per project
Accepted (v4). Exclusive Web Lock per project; other tabs are read-only with explicit takeover; `BroadcastChannel` revision notifications.

## ADR-021 — Durable local storage strategy
Accepted (v4). `navigator.storage.persist()` + first-class `.iconproj` file save (File System Access API where available) + unsaved-to-file tracking. IndexedDB is treated as a working cache, not the only copy.
*Rejected for V1:* OPFS as the primary store (same eviction class); a desktop shell (Tauri) — re-evaluate post-V1 if file-system integration demand is high, since the Rust toolchain already exists.

## ADR-022 — Outline engine as a first-class compiler stage
Accepted (v4). `IOutlineEngine` provides stroke→fill expansion (caps, joins, miter limit), overlap removal and winding normalization. Required for font export and the Expert "Outline stroke" command. Implementation selected by spike S-03; Rust/WASM (Skia-derived stroker in `tiny-skia`/`kurbo` class libraries) is the expected winner.

## ADR-023 — Font outline flavours
Accepted (v4). V1 baseline: OTF (CFF) + WOFF2. TTF (`glyf`) produced via cubic→quadratic conversion (tolerance ≤ unitsPerEm/1000) and shipped only if spike S-05 passes. A `.ttf` extension is never used for CFF data.

## ADR-024 — Agent surface: MCP primary, WebMCP experimental
Accepted (v4). A stdio MCP server in the CLI is the supported agent integration. WebMCP is feature-flagged and capability-detected because it is a single-browser origin trial whose API has already moved (`navigator.modelContext` → `document.modelContext`).

## ADR-025 — Non-DOM SVG parsing in a worker
Accepted (v4). `DOMParser` is unavailable in workers and exposes browser DTD handling. Import uses a pure-JS streaming XML parser with DOCTYPE rejection, inside a terminable worker.

## ADR-026 — Single command envelope and registry
Accepted (v4). `specs/SCHEMAS.md` §6–7 is the only definition; it supersedes the draft envelope in v3 `AUTOMATION_CONTRACT.md`. Adds `dryRun`, `actor`, `issuedAt`, idempotent `commandId`, `status`, `patchSummary`.
