# Product Requirements Document

## 1. Problem
Icon creation tools are typically either professional vector editors, fixed icon libraries, or font generators. Non-designers struggle to create a coherent custom set, while experts need precision, batch operations, font controls, validation and automation.

## 2. Product
The product is an **icon-system creation platform**, not a general illustration application. It provides:
- Beginner Mode: guided creation and set-wide styling in human terminology.
- Expert Playground: vector/path/font/source/validation tooling.
- AI assistance: semantic creation, modification, normalization and set completion.
- Developer automation: shared command layer exposed through CLI, API and agent/tool adapters.
- Compiler: project source -> SVG, sprites, raster, ICO, fonts and framework packages.

## 3. Personas
### Layperson
Needs recognizable, consistent icons without vector expertise.
### Designer
Needs geometry, Bézier/path operations, grids, optical correction, variants and non-destructive control.
### Developer
Needs currentColor/tokens, accessible markup, reproducible packages, icon fonts, framework components and CI validation.
### Design-system owner
Needs rules, versioning, provenance, review and organization-wide consistency.

## 4. Primary jobs
- Create a matching icon set from descriptions, library assets, primitives or imported SVGs.
- Modify one icon without breaking the set's visual language.
- Normalize an imported mixed set.
- Produce deployment-ready artifacts without understanding font internals or SVG packaging.
- Validate an icon repository in CI.

## 5. Modes
Mode is presentation, not document capability. Switching modes MUST NOT alter or flatten the document.

### Beginner Mode
Create/search/import; simple canvas; style controls; set overview; one-click consistency; previews; export wizard.

#### Beginner control capability matrix (V1)
Controls are honest about what the geometry engine can do. A control that cannot apply to the current selection is disabled with a one-line reason, never applied approximately.

| Control | Strokes | Primitives (rect/ellipse/line/polyline) | Raw filled paths |
|---|---|---|---|
| Weight | stroke width | stroke width | disabled ("filled shape — use Expert › Offset", post-V1) |
| Roundness | caps/joins | corner radius (rect), joins | disabled (post-V1 fillet) |
| Size / Padding / Align | ✓ (transform) | ✓ | ✓ |
| Colour | token / currentColor | ✓ | ✓ |
| Style outline↔filled | — (reported as not convertible) | — | — |

### Expert Mode
Node/path editing; numeric inspector; layers/components; Boolean operations; source SVG; recipe view; grid/keylines; batch operations; Font Lab; validation; code preview.

## 6. V1 functional scope
- Project/set creation, autosave and portable project export/import.
- SVG import with sanitization.
- Primitive creation: rectangle, rounded rectangle, circle/ellipse, line, polyline/polygon, path.
- Select/move/scale/rotate/flip/align/distribute.
- Fill/stroke/currentColor; caps/joins; configurable grid and safe area.
- Layers/groups/visibility/lock.
- Undo/redo command history.
- Shared design rules: grid, safe area, stroke, caps, joins, corner policy, default color token.
- Deterministic validation with actionable violations.
- Multi-size and light/dark preview.
- Batch rule application with preview/diff.
- Expert live SVG source editing with parse errors and round-trip preservation for supported constructs.
- Export: optimized SVG, SVG sprite, PNG sizes, multi-resolution ICO, icon font package (OTF + WOFF2 baseline; TTF if spike S-05 passes; CSS + manifest + demo). Stroked icons are outlined automatically for font export. Legacy WOFF (1.0) is not produced — every supported browser loads WOFF2.
- Expert: segment/node editing, Boolean operations (diagnosed where the engine cannot produce a correct result), outline-stroke.
- Project ZIP export/import.
- Starter icon library (≥ 300 icons) of permissively licensed (MIT/ISC/Apache-2.0/CC0) or first-party icons with provenance pre-populated, so the first-run success criterion does not depend on import skills.
- Durable local work: persistent-storage request, first-class `.iconproj` file save, unsaved-to-file indicator, crash recovery, single-writer protection across tabs.

## 7. V1 non-goals
- General-purpose illustration/photo editing.
- Full Figma/Illustrator replacement.
- Real-time multiplayer editing.
- Marketplace.
- Arbitrary third-party plugin execution.
- Full animation authoring.
- AI as a mandatory dependency.

## 7a. V1 release increments
M1 walking skeleton (internal) → M2 alpha (design partners) → M3 beta (public) → M4 GA. See `implementation/ROADMAP.md`.

## 8. Post-V1
AI recipe generation, style completion, path offset/fillet for filled icons (Weight/Roundness on any shape), raster tracing, optical masters, animation, framework packages, publishing, collaboration, review/approval, plugin SDK, organization policies, CI service and cloud sync.

## 9. UX success criteria
- New user can create/import 5 icons and export SVG/ICO/font without reading technical documentation (≥ 5 of 6 moderated test participants, median ≤ 15 min).
- A user never loses committed work to a browser crash, a second tab, or a closed tab (journal recovery + single writer); the UI always shows whether work is saved to a file.
- Switching Beginner -> Expert -> Beginner is lossless.
- Set-wide style change previews affected icons before commit.
- Every validation failure explains the rule, affected geometry and suggested correction.
- Expert can edit SVG and immediately see canvas result.

## 10. Engineering acceptance
- Identical project + compiler version + options yields byte-identical artifacts across Node CLI, Chromium, Firefox and WebKit (ADR-018).
- Snapshot + journal replay reproduces the project byte-for-byte.
- Core editing/export works offline.
- Malicious SVG script/event/external-resource/DTD constructs never execute or expand; imported markup never reaches the live DOM.
- Unsupported SVG constructs are rejected or preserved explicitly; never silently corrupted.
- Undo/redo operates through the same command abstraction used by automation.
- Exporters never mutate canonical project state.

## 11. Product metrics
Activation: first set exported. Time-to-first-export. Successful export rate. Validation auto-fix acceptance. Beginner->Expert conversion. Repeat projects. Compilation failure rate. Undo-after-batch rate. Import fidelity incidents.
