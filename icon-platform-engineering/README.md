# Icon Platform — Implementation Engineering Package

Status: **v4** — implementation baseline after engineering review (see `REVIEW_V3_TO_V4.md`). Phase 0 may start; Phase 1 starts only after spikes S-01…S-06 pass.

## Product thesis
A local-first icon-system creation platform that is approachable for non-designers while providing a precision Expert Playground for designers and developers. One canonical project model powers Beginner UI, Expert UI, AI assistance, automation, CLI/API/WebMCP surfaces, validation, and deterministic compilation.

## Core principles
1. SVG/vector geometry is canonical; raster/font/framework outputs are compiled artifacts.
2. Beginner and Expert modes edit the same document without fidelity loss.
3. Commands are centralized; UIs and automation are adapters.
4. Deterministic rules handle geometry/validation; AI assists rather than becoming the source of truth.
5. Local-first by default; cloud is optional for AI, sync, collaboration, backup, teams and marketplace.
6. Imported SVG/font/archive content is untrusted.
7. V1 proves editing + consistency + compilation before broad collaboration/marketplace features.
8. Determinism is engineered, not assumed: quantized geometry, pure replayable commands, cross-engine parity in CI.
9. Local-first means durable: IndexedDB is a working cache; the user's file is the durable copy.
10. Controls are honest: a capability the geometry engine cannot deliver robustly is disabled and explained, never approximated.

## Documents
- `REVIEW_V3_TO_V4.md` — review findings, feasibility assessment, rationale and change log. **Read first.**
- `PRD.md` — product requirements, personas, scope and acceptance criteria.
- `ux/UX_FLOWS.md` — Beginner/Expert workflows and interaction model.
- `architecture/ARCHITECTURE.md` — system architecture and module boundaries.
- `specs/SCHEMAS.md` — **normative** model, command envelope and registry.
- `specs/PROJECT_MODEL.md` — explanatory companion to `SCHEMAS.md`.
- `specs/ICON_RECIPE.md` — structured parametric icon recipe specification.
- `specs/COMPILER_EXPORTS.md` — SVG/sprite/PNG/ICO/font/framework compilation.
- `specs/AUTOMATION_CONTRACT.md` — CLI, MCP (primary agent surface), WebMCP (experimental) and REST adapters.
- `security/SECURITY_AND_LICENSING.md` — threat model, SVG/font/ZIP safety and provenance.
- `adrs/ADR_INDEX.md` — architectural decisions.
- `implementation/ROADMAP.md` — phased implementation and verification gates.
- `implementation/CODING_AGENT_INSTRUCTIONS.md` — execution rules for coding agents.
- `implementation/REPOSITORY_STRUCTURE.md` — monorepo layout and boundaries.
- `implementation/DEPLOYMENT_AND_OPERATIONS.md` — container, headers, CI/CD, release, observability.

## V1 definition
V1 is a production-quality local-first editor supporting projects/sets, SVG import, basic vector construction/editing, layers, undo/redo, set-wide style rules, deterministic validation, preview, and compilation to SVG, sprite, PNG, ICO and icon-font packages (OTF/WOFF2 baseline, TTF conditional). Expert Mode exposes precision controls and live SVG. AI generation, collaboration, marketplace and third-party plugin execution are post-V1 unless explicitly pulled forward.

## Readiness closure additions
- `ux/WIREFRAMES_AND_DESIGN_SYSTEM.md` — detailed Beginner/Expert/Font/Export surfaces and interaction rules.
- `implementation/TECHNOLOGY_SPIKES.md` — V1 library baselines and acceptance gates.
- `implementation/BROWSER_AND_PERFORMANCE_BUDGETS.md` — browser matrix and measurable budgets.
- `testing/FIXTURE_CORPUS.md` — geometry, security, compiler, font, migration, E2E and scale fixtures.

## Official technology baseline
Angular 22 + TypeScript 6.0 web shell; framework-independent TypeScript core (also runs headless in Node for CLI/MCP); native SVG DOM editor; Angular Signals; Web Workers; IndexedDB/Dexie + Web Locks + File System Access; selective Rust/WASM (outline engine, strategic Booleans); resvg rasterization; opentype.js + cu2qu fonts; pnpm + Nx; Vitest + fast-check + Playwright; unprivileged Nginx container; optional ASP.NET Core/.NET 10 + PostgreSQL cloud layer. See `implementation/TECH_STACK.md`.
