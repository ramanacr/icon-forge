# Engineering Review: v3 → v4

Status: Review complete. v4 supersedes v3. Reviewed 2026-10-02 against the stack as it actually ships today (Angular 22 requires TypeScript `>=6.0 <6.1`; .NET 10 is the current LTS; WebMCP is a Chrome-only origin trial whose API moved from `navigator.modelContext` to `document.modelContext`).

## 1. Verdict

The v3 **architecture is sound and should be kept**: canonical model ≠ SVG, one command layer for UI/automation/AI, local-first, pure compiler stages, adapters around every third-party library, hostile-input posture. These are the right load-bearing decisions and they are internally consistent.

The v3 **readiness gate ("Documentation readiness: PASS") was premature.** The package contained contradictions between normative documents, several product promises that the chosen geometry stack cannot fulfil, and three platform realities that would cause data loss or broken determinism in production. None of these require changing the architecture; all of them would have caused coding agents to diverge or ship defects.

**Feasibility: feasible, with corrections.** V1 as scoped is a large product (a constrained vector editor + rule engine + four binary exporters + font compiler). Estimated effort for a team of 4–6 senior engineers (2 core/geometry, 1–2 Angular/editor UX, 1 compiler/font, shared QA/DevOps): **11–15 months to V1 GA**, with a usable internal alpha (walking skeleton → SVG export) at ~3 months. The highest-risk items are geometry robustness (Booleans, stroke outlining) and font output, not the UI.

## 2. Findings

Severity: **B** = blocker (would cause divergent implementations, data loss or a false product promise), **H** = high, **M** = medium.

### 2.1 Contradictions between normative documents

| # | Sev | Finding | v4 resolution |
|---|---|---|---|
| C1 | B | Two incompatible command envelopes: `AUTOMATION_CONTRACT.md` (`command`, `version`, `targets`, `arguments`, `dryRun`) vs `SCHEMAS.md` (`commandVersion`, `type`, `payload`, `expectedRevision`, no `dryRun`). | One envelope, defined only in `SCHEMAS.md`; automation doc references it. `dryRun` added (the PRD's batch preview requires it). ADR-026. |
| C2 | B | Two command vocabularies: `icon.create/normalize`, `variant.*`, `batch.apply`, `project.save` vs `icon.add`, `set.applyStyle`, no variant commands. | Single registry in `SCHEMAS.md`. Persistence (`save`) removed from the command set — it is a repository concern, not a document mutation. |
| C3 | H | `PROJECT_MODEL.md` has `tokens`, `licenses`, `metadata`, explicit variant dimensions, optical policies; `SCHEMAS.md` v1 has none of these but `PaintV1` references tokens that are never defined. | `SCHEMAS.md` is the single normative model; `PROJECT_MODEL.md` becomes explanatory and points to it. Tokens are defined. |
| C4 | H | `SCHEMAS.md` says unknown fields are rejected, yet uses `Record<string, unknown>` for variant overrides, primitive props and component parameters — i.e. untyped holes in the core contract. | Typed primitive unions, typed override operations, typed component parameters. |
| C5 | H | Fixture corpus includes `evenodd-vs-nonzero` and accepts a `clip-path` subset, but the schema has no `fillRule` and no clip construct. Importing either would silently degrade — violating ADR-011. | `fillRule` added. `clip-path` is accepted only via an explicit, reported lossy conversion (Boolean intersect) or rejected. |
| C6 | M | `duotone` is a design-system style, but nothing in the model identifies primary vs secondary layers. | `role: "primary" | "secondary"` on paintable nodes. |
| C7 | M | Roadmap Phase 3 exit ("5-icon SVG export") depends on the compiler, scheduled in Phase 5. | Roadmap re-sequenced as a walking skeleton: minimal SVG compile lands in Phase 1. |

### 2.2 Product promises the stack cannot keep as written

| # | Sev | Finding | v4 resolution |
|---|---|---|---|
| P1 | B | **Icon fonts cannot contain strokes.** Outline-style icons (the default style in the examples: `stroke: 1.75`, round caps/joins) must be converted to filled outlines with correct caps/joins/miters, overlaps removed and contour direction normalized. v3 has no stroke-outlining component; Paper.js does not provide robust stroke expansion. | New `IOutlineEngine` compiler stage (stroke→fill, overlap removal, winding normalization). Spike S-03 is now a Phase 0 gate. ADR-022. |
| P2 | B | **Beginner "Weight" and "Roundness" on arbitrary paths** require path offsetting and corner filleting on arbitrary Béziers — hard, non-robust geometry. As written, every imported filled icon would be expected to respond to a weight slider. | Capability matrix: these controls drive stroke width, primitive radii and recipe parameters. For raw filled paths the control is disabled with an explanation. Offset/fillet on arbitrary paths is post-V1 (Rust/WASM). |
| P3 | H | **"TTF" output.** opentype.js is a reader of both outline flavors, but its writer emits CFF-flavoured OpenType. A file named `.ttf` containing CFF is technically valid OpenType but is not what users expecting TrueType (`glyf`, quadratic) get. | Baseline deliverable: OTF(CFF) + WOFF2. `.ttf` (`glyf`) via cubic→quadratic conversion (cu2qu, tolerance ≤ upem/1000) behind `IFontCompiler`; shipping `.ttf` is gated by spike S-05. ADR-023. |
| P3b | M | **WOFF 1.0** was listed as a deliverable. Every browser in the support matrix loads WOFF2; WOFF 1.0 adds an encoder dependency and test surface with no user benefit. | Dropped from V1 deliverables. |
| P4 | H | **Icon-font ligatures** need the input characters (`a`–`z`, `_`, `-`, digits) mapped in `cmap` to glyphs; v3 omits this, so ligatures would silently fail. | Font spec now requires a generated input-glyph set (zero-contour, defined advance). |
| P5 | M | **Built-in icon library** is assumed by the first-run success criterion ("create 5 icons") but no library, licence or provenance source is specified. | PRD names this as a V1 requirement with licence constraints (permissive, attribution-tracked). |

### 2.3 Platform realities that cause data loss or broken guarantees

| # | Sev | Finding | v4 resolution |
|---|---|---|---|
| R1 | B | **Cross-engine determinism.** `Math.sin/cos/atan2/pow` are implementation-approximated and are not guaranteed bit-identical across V8 (Chrome, Node CLI), SpiderMonkey and JavaScriptCore. Rotation/arc conversion results can differ in the last ULP, which survives rounding at boundary cases. The Phase 8 exit ("headless compile = UI compile") and the deterministic-artifact acceptance are therefore not guaranteed by v3. | Canonical geometry is **quantized at command commit** (fixed precision, default 1/1000 unit). Transcendental math happens only inside command handlers, and its *result* is persisted; the compiler uses only `+ − × ÷`, comparisons and quantization. CI runs the golden suite on Chromium, Firefox, WebKit and Node and requires byte-identical hashes. ADR-018. |
| R2 | B | **Non-deterministic command replay.** Autosave = snapshot + command journal. If handlers generate IDs (`crypto.randomUUID`) or timestamps, journal replay after a crash creates different IDs, breaking references, selection and undo history. | All IDs, timestamps and seeds are generated by the adapter and travel in the envelope/payload. Handlers are pure `(state, command) → (state, patches, inversePatches)`. ADR-018. |
| R3 | B | **Storage eviction.** IndexedDB is best-effort storage. Safari deletes script-writable storage for sites without user interaction in the last 7 days unless installed as a web app; all browsers may evict under pressure. A local-first editor that keeps the only copy of a user's work in IndexedDB will lose data. | `navigator.storage.persist()` requested; persistence status shown in UI; `.iconproj` file save is first-class (File System Access API where available, download otherwise); unsaved-to-file reminder; eviction-recovery test. ADR-021. |
| R4 | B | **Multi-tab corruption.** Two tabs opening the same project both autosave → lost writes. Not addressed in v3. | Single writer per project via Web Locks API; second tab opens read-only with "take over" action; `BroadcastChannel` for revision notifications. ADR-020. |
| R5 | H | **SVG import in workers.** `DOMParser` is not available in Web Workers, yet v3 wants hostile parsing off the main thread. Parsing hostile SVG with `DOMParser` on the main thread also exposes DTD/entity handling to the browser parser. | Non-DOM XML parser in the import worker; `<!DOCTYPE>` rejected outright; `use` expansion with depth/count limits. ADR-025. |
| R6 | H | **CSP and WebAssembly.** v3 says "CSP must not require `unsafe-eval`" but WebAssembly compilation requires `'wasm-unsafe-eval'` in `script-src`. Without stating this, the security baseline and the WASM strategy contradict each other. | Normative CSP added to the security spec (`'wasm-unsafe-eval'` allowed, `unsafe-eval` forbidden, Trusted Types enforced). |
| R7 | H | **WebMCP is not a stable platform.** It is a Chrome-only origin trial, and its entry point has already moved from `navigator.modelContext` to `document.modelContext`. Making it *the* agent surface couples a core automation guarantee to an experimental API. | Primary agent surface: a standard MCP server (stdio) shipped with the CLI over the same command layer. WebMCP is a feature-flagged, capability-detected adapter. ADR-024. |
| R8 | M | WASM threads require cross-origin isolation (COOP/COEP), which complicates hosting and third-party embeds. | V1 WASM modules are single-threaded; parallelism comes from a worker pool. |

### 2.4 Geometry library risk

Paper.js is a reasonable bootstrap but its Boolean operations are known to struggle with coincident/touching edges and near-degenerate input, the project is mature with a slow release cadence, and running it headless inside a Web Worker must be proven. v3 already isolates it behind `IGeometryEngine` (good). v4 adds: a known-weakness fixture list it must pass or diagnose; explicit rejection of polygon-only libraries (e.g. Clipper2) as the canonical Boolean engine because they flatten curves; CanvasKit/Skia PathOps rejected for bundle size; Rust candidates evaluated against the same conformance suite.

### 2.5 Gaps

- No deployment, hosting or operational specification (headers, container, CI/CD stages, release signing, observability). Added `implementation/DEPLOYMENT_AND_OPERATIONS.md`.
- No effort/team assumptions in the roadmap. Added.
- No path representation decision: a raw `d` string as canonical state forces re-parsing for every edit and makes quantization and node-level diffing ambiguous. v4 makes structured absolute segments canonical (ADR-019).
- Live SVG source editing must preserve node IDs across text edits or undo/selection break. v4 specifies ID-preserving reconciliation.
- SVG export uses a project-owned serializer from canonical geometry; no general-purpose SVG optimizer in the pipeline (non-deterministic across versions, and it can change semantics).

## 3. What did not change, and why

- **Angular 22 + TypeScript 6.0** stays. It is current, and Angular 22 pins TS to `>=6.0 <6.1`, so the TS line is decided by Angular, not by us. The native (Go) TypeScript compiler is adopted only when Angular's toolchain supports it.
- **SVG DOM renderer** stays. Correct for icon-scale scenes; canvas/WebGL only for thumbnails at scale.
- **.NET 10 + PostgreSQL** cloud stays optional and post-V1. Pulling it into V1 would violate the local-first thesis and add an operational surface with no V1 user value.
- **Node/TypeScript CLI** stays: it reuses the core packages verbatim, which is what makes CLI/UI artifact parity achievable.
- **Recipes and AI** remain Phase 9 / post-V1. The schema reserves the reference; nothing more.

## 4. File-level change log

| File | Change |
|---|---|
| `REVIEW_V3_TO_V4.md` | New — this document. |
| `README.md` | Status, principles 8–10, document map, gate. |
| `PRD.md` | Capability matrix for Beginner controls, durability requirement, library licensing, release increments, refined acceptance. |
| `IMPLEMENTATION_CHECKLIST.md` | Gate changed to conditional; blocking items enumerated. |
| `architecture/ARCHITECTURE.md` | Determinism model, worker topology, single-writer, durability, outline stage, agent surfaces. |
| `adrs/ADR_INDEX.md` | ADR-015 amended; ADR-018 … ADR-026 added. |
| `specs/SCHEMAS.md` | Rewritten as the single normative model + envelope + registry. |
| `specs/PROJECT_MODEL.md` | Explanatory; defers to `SCHEMAS.md`. |
| `specs/AUTOMATION_CONTRACT.md` | Rewritten over the unified envelope; MCP primary, WebMCP experimental. |
| `specs/COMPILER_EXPORTS.md` | Outline stage, font flavor/ligature rules, deterministic packaging. |
| `security/SECURITY_AND_LICENSING.md` | Normative CSP, XML parsing, `use` limits, supply-chain specifics. |
| `implementation/TECH_STACK.md` | Version facts, new adapters, agent surface, hosting. |
| `implementation/TECHNOLOGY_SPIKES.md` | Spikes S-01 … S-10 with owners of risk and gates. |
| `implementation/ROADMAP.md` | Walking-skeleton re-sequencing, estimates, increments. |
| `implementation/REPOSITORY_STRUCTURE.md` | New packages (application, outline, xml, mcp-server), deploy folder. |
| `implementation/CODING_AGENT_INSTRUCTIONS.md` | Determinism/purity rules, stop conditions. |
| `implementation/BROWSER_AND_PERFORMANCE_BUDGETS.md` | WASM payload budgets, durability/parity gates. |
| `implementation/DEPLOYMENT_AND_OPERATIONS.md` | New. |
| `testing/FIXTURE_CORPUS.md` | Determinism, outline, font flavor, concurrency, eviction fixtures. |
| `ux/UX_FLOWS.md`, `ux/WIREFRAMES_AND_DESIGN_SYSTEM.md` | Capability-aware controls, save/durability and read-only-tab UX. |
| `specs/ICON_RECIPE.md` | Unchanged except evaluation output must be quantized (ADR-018). |
