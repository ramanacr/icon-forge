# Official Technology Stack and Rationale

Status: **Accepted baseline (v4).** Supersedes stack statements elsewhere. Library selections marked † are conditional on the spike in `TECHNOLOGY_SPIKES.md`; a failed spike swaps the adapter, never the model.

## Executive decision
IconForge is a **TypeScript-first, local-first web application** whose framework-independent core also runs headless in Node (CLI + MCP server). Rust/WebAssembly is used selectively where it materially improves robustness, performance or determinism — in practice geometry (Booleans, stroke outlining) and codecs. Angular is the presentation shell, not the domain architecture.

## Baseline stack

| Layer | Technology | Decision / rationale |
|---|---|---|
| Web UI | Angular 22, TypeScript 6.0.x | Angular 22 requires TS `>=6.0 <6.1`; pin exact patch. Zoneless + OnPush/signals for editor performance. |
| UI primitives | Angular CDK + custom components | Editor UX needs custom panels, overlays, virtual scroll, a11y primitives — not a widget suite. |
| Styling | SCSS + CSS custom properties | Design tokens; light/dark. |
| UI state | Angular Signals | Ephemeral UI state only. |
| Canonical core | Framework-independent TS packages | Model, commands, application, rules, compiler contracts. |
| Schema validation | JSON Schema 2020-12 generated from TS types; Ajv (precompiled standalone validators) | Precompiled validators avoid runtime `new Function` (CSP-safe). |
| Patches | Project-owned structural patch format (or Immer patches behind an adapter) | Patches are persisted in the journal, so their format must be ours. |
| Renderer | Native SVG DOM, programmatic | ADR-005. |
| Boolean geometry | Paper.js † behind `IGeometryEngine` | Bootstrap; Rust/WASM strategic (ADR-015). |
| Stroke outline / overlap removal | Rust/WASM † behind `IOutlineEngine` | Required for fonts (ADR-022). |
| SVG import parsing | Pure-JS streaming XML parser (saxes-class) † behind `IXmlReader` | Works in workers; DOCTYPE rejected (ADR-025). |
| Rasterization | resvg WASM † behind `IRasterizer` | Deterministic, no system fonts needed. |
| Font construction | opentype.js † behind `IFontCompiler` (CFF/OTF) + cu2qu → `glyf` † | ADR-023. Rust `write-fonts`-class compiler is the fallback if S-05 fails. |
| WOFF2 | WASM Brotli/WOFF2 encoder † behind `IWoff2Encoder` | Pinned by hash. |
| ICO | Project-owned encoder (ICONDIR + BMP/PNG entries) behind `IIcoCompiler` | Format is small and fully specified; owning it avoids an unmaintained dependency. Verified by decoding. |
| Archive | fflate † behind `IArchiveService` | Deterministic entries; streaming limits. |
| Persistence | IndexedDB via Dexie behind `IProjectRepository`; File System Access API adapter; Web Locks; BroadcastChannel | ADR-020/021. |
| Background work | Dedicated + pooled Web Workers (Comlink-style RPC, or hand-rolled typed messaging) | Off-main-thread import/compile/validation. |
| PWA | Angular service worker | Offline shell; install improves storage durability on Safari. |
| Unit/component tests | Vitest (Angular 21+ default runner) | |
| Property tests | fast-check | Transforms, quantization, serialization, migrations. |
| E2E / cross-engine | Playwright (Chromium, Firefox, WebKit) | Includes cross-engine golden-hash parity. |
| Workspace | pnpm workspaces + Nx (module boundary lint rules) | ADR-017. |
| Rust | Pinned stable toolchain, `wasm-bindgen`, `wasm-opt`; reproducible builds | WASM artefacts versioned and hash-pinned. |
| CLI / MCP server | Node.js 24 LTS, TypeScript; MCP TypeScript SDK (stdio) | Reuses core packages verbatim → artifact parity. |
| Static hosting | OCI image: unprivileged Nginx serving immutable assets with strict headers | See `DEPLOYMENT_AND_OPERATIONS.md`. |
| Cloud API (post-V1) | ASP.NET Core / .NET 10 LTS, minimal APIs + OpenAPI; EF Core + Npgsql | Identity, tenancy, sync, sharing, AI gateway, audit. |
| Cloud DB / storage | PostgreSQL 17+; S3-compatible object storage | Project packages stored as content-addressed blobs. |
| Realtime (later) | SignalR | Collaboration phase only. |
| Cloud observability | OpenTelemetry (traces/metrics/logs) → OTLP collector | Vendor-neutral. |
| AI | Provider-neutral gateway (server-side in cloud; BYO key locally) | Optional, Phase 9. |
| Agent surface | MCP (stdio) primary; WebMCP experimental flag | ADR-024. |
| CI/CD | GitHub Actions | Build, test, cross-engine parity, security, SBOM, signing. |

## Architectural rule
No Angular, Paper.js, Dexie, resvg, opentype.js, archive, XML-parser, ASP.NET or AI-provider type may appear in `project-model`, `commands` or `application`. Nx tags enforce this in lint and in the task graph.

## Why Angular
Disciplined shell, DI, routing, CDK accessibility primitives, long-term support cadence; Signals fit UI state. The engine stays usable without Angular (proven by the CLI).

## Why SVG DOM, not Canvas, for V1
Icons are small vector scenes; SVG preserves object identity, maps naturally to selection/inspection and keeps the editor close to the export domain.

## Why Rust/WASM selectively
Ordinary product logic stays in TS. Rust/WASM is justified where JS libraries are weak or non-deterministic: robust Booleans, stroke outlining, offsetting (post-V1), tracing (post-V1), codecs.

## Why not TypeScript 7 / native compiler now
Angular 22's compiler integration pins TS 6.0. The native compiler is adopted when Angular's toolchain supports it; core packages avoid TS features deprecated in 6.0 (e.g. `baseUrl`) to keep that upgrade cheap.

## Version policy
Exact versions pinned in lockfiles, `packageManager` field, `rust-toolchain.toml`, `.nvmrc`, and container base images by digest. Upgrades arrive as dedicated PRs that must pass conformance, golden (cross-engine), E2E, performance and bundle-size gates. Angular majors are adopted within one minor of release, after core dependency compatibility is confirmed.
