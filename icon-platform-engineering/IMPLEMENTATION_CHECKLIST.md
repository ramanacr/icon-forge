# Implementation Readiness Checklist (v4)

## Carried from v3
- [x] Product thesis and personas
- [x] Beginner/Expert mode boundary
- [x] Local-first architecture
- [x] Compiler/export architecture
- [x] Licensing/provenance model
- [x] ADR baseline
- [x] Coding-agent execution rules
- [x] Working codename: **IconForge** (replaceable)
- [x] Wireframes/design-system specification
- [x] Browser matrix and performance budgets
- [x] Fixture corpus specification

## Resolved in v4 (were blocking)
- [x] Single command envelope and registry (C1, C2 → ADR-026)
- [x] Single normative model; tokens, `fillRule`, duotone roles, typed overrides (C3–C6)
- [x] Roadmap dependency order / walking skeleton (C7)
- [x] Font outline stage for stroked icons (P1 → ADR-022)
- [x] Honest Beginner control capability matrix (P2)
- [x] Font flavour and ligature input-glyph rules (P3, P4 → ADR-023)
- [x] Starter library licensing requirement (P5)
- [x] Cross-engine determinism and pure replayable commands (R1, R2 → ADR-018)
- [x] Storage durability (R3 → ADR-021)
- [x] Multi-tab single writer (R4 → ADR-020)
- [x] Worker-safe hostile SVG parsing (R5 → ADR-025)
- [x] Normative CSP including `'wasm-unsafe-eval'` (R6)
- [x] Agent surface not coupled to an origin trial (R7 → ADR-024)
- [x] Deployment, CI/CD, release and observability specification
- [x] Effort/team assumptions and release increments

## Open (gate Phase 1, closed by executable evidence — not by documentation)
- [ ] S-01 determinism parity · [ ] S-02 Booleans · [ ] S-03 outline engine
- [ ] S-04 raster · [ ] S-05 font build · [ ] S-06 durability/locking

## Gate
**Documentation readiness: PASS (v4).** **Implementation readiness: CONDITIONAL** — Phase 0 may begin now; Phase 1 begins when S-01…S-06 are green or have recorded adapter swaps. A failed spike changes an adapter, never the project model.
