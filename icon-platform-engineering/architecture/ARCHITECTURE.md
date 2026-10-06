# Architecture

## Logical architecture

```text
 Beginner UI    Expert UI    AI proposal panel     CLI      MCP server    WebMCP (flag)
      \             |              /                 \          |            /
       +------ Application layer (commands, queries, history, policy) -----+
                                    |
                 +------------------+-------------------+
                 |                  |                   |
             Icon engine        Rule engine          Compiler
        geometry · outline     validate · fixes   SVG · sprite · PNG
        recipes (Phase 9)                          ICO · font · package
                 |                  |                   |
                 +---------- Canonical project model ---+
                                    |
                     Repository (IndexedDB · file · cloud later)
```

## Architectural style
Local-first modular monolith running in the browser; the same core packages run headless in Node for the CLI and MCP server. Angular 22 provides the shell only. Rust/WASM is introduced selectively for measured geometry/compiler workloads (ADR-014). The backend is optional and never required for edit/export (ADR-004, ADR-016).

## Modules
- `project-model` — types, generated JSON Schemas, canonical serializer, quantization, migrations. Zero dependencies beyond the schema validator.
- `commands` — command handlers (pure), transactions, patch/inverse-patch generation.
- `application` — dispatcher, history, revision/concurrency, confirmation policy, query routing. The only module adapters talk to.
- `geometry` — matrices, bounds, hit-testing, snapping, `IGeometryEngine` contract.
- `outline` — `IOutlineEngine` contract (stroke→fill, overlap removal, winding normalization).
- `recipes` — Phase 9.
- `rules` — deterministic validators and fix proposals (as dry-runnable commands).
- `svg-import` — XML parsing (non-DOM), allowlist, canonicalization, diagnostics.
- `compiler-*` — pure stages and exporters.
- `persistence` — repository contracts + IndexedDB/file adapters, journal, locking.
- `automation` — CLI, MCP and WebMCP adapters.
- `app` — Angular presentation.

## State
- Canonical document state: immutable, serializable, quantized, owned by the application layer.
- Ephemeral UI state (selection, viewport, panels, hover, drag previews) lives in Angular Signals and is never persisted in the project.
- Commands produce patches + inverse patches; history stores **transactions** (one user gesture = one transaction, e.g. a whole drag commits once on pointer-up; intermediate frames are rendered from a transient preview layer and are not commands).

## Determinism model (ADR-018)
1. Adapters create all IDs (UUIDv7), timestamps and seeds before dispatch; handlers are pure.
2. Geometry is quantized at commit (`QUANTUM = 0.001`).
3. Transcendental math only inside handlers; the compiler uses arithmetic only.
4. Journal replay of `(snapshot, commands[])` reproduces the same project byte-for-byte.
5. CI: replay tests, cross-engine golden hashes (Node, Chromium, Firefox, WebKit).

## Threading

```text
Main thread:  Angular UI · application layer · SVG canvas renderer · interaction
              (commands are small and fast; p95 apply ≤ 50 ms)
Import worker:   XML parse → allowlist → canonicalize (terminated on limit/time breach)
Compute pool:    validation of large sets · Boolean/outline ops for batch · thumbnail raster
Compiler worker: compile.run (all exporters, WASM codecs)
```
Workers receive immutable snapshots (structured clone) and return results; they never hold authoritative state. V1 WASM is single-threaded; parallelism comes from the pool (no COOP/COEP requirement). Pool size = `min(4, hardwareConcurrency − 1)`.

## Persistence and durability (ADR-020, ADR-021)
- IndexedDB (Dexie) stores: latest snapshot per project + bounded command journal (compacted into a new snapshot every 200 commands or 30 s idle) + preserved originals.
- Compaction stores a checksummed dispatcher history checkpoint alongside the snapshot, preserving undo/redo and command idempotency across reopen. Existing rows without a checkpoint still replay normally; the checkpoint does not change `ProjectV1`.
- **Single writer:** opening a project acquires a Web Lock `iconforge:project:{id}` (exclusive). A second tab opens read-only and can request takeover; the holder flushes and releases. `BroadcastChannel` announces new revisions to read-only viewers.
- **Durability:** request `navigator.storage.persist()` on first project creation; surface status. `.iconproj` file save is first-class: File System Access API (Chromium) gives true "Save" to a user file handle; elsewhere "Save" downloads. The UI tracks "changes not saved to a file" and reminds on a cadence, because IndexedDB alone can be evicted (Safari's 7-day rule for non-installed sites, quota pressure everywhere).
- Crash recovery: on open, replay journal after snapshot; journal entries are checksummed; a corrupt tail is truncated and reported.
- Cloud persistence later implements the same repository interface.

## Rendering
Native SVG DOM, built programmatically from the canonical model (never from imported markup or export output). Each icon renders as one `<svg>`; Expert overlays (handles, guides, grid) are a separate layer. Thumbnails: virtualized grid; >300 visible thumbnails switch to cached raster bitmaps from the compute pool.

## Compiler
Pure stage graph in a worker (see `specs/COMPILER_EXPORTS.md`). Stroke-bearing icons pass through `IOutlineEngine` for font targets (ADR-022). Fonts: OTF(CFF) + WOFF2 baseline, TTF via cu2qu conditional on spike S-05 (ADR-023).

## AI boundary (Phase 9)
AI never mutates state. It returns a proposed recipe or command plan, validated against schemas and project policy, previewed as a dry-run diff, applied only on user confirmation as one transaction with `actor.kind = "ai-proposal"`.

## Agent surfaces (ADR-024)
MCP server (stdio, CLI process) is primary. WebMCP is a feature-flagged adapter registered only when `document.modelContext` (or legacy `navigator.modelContext`) exists. Both map to the same tool set and confirmation policy.

## Cross-cutting
- **Errors:** every failure is a `DiagnosticV1` with a stable code; UI text is derived, not parsed.
- **Observability (client):** structured local log ring buffer (exportable with a support bundle the user reviews before sending), performance marks for every budgeted operation, opt-in anonymous telemetry per `SECURITY_AND_LICENSING.md`.
- **Accessibility:** canvas objects mirrored in an accessible layer tree; all commands reachable via keyboard/command palette.
