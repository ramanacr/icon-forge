# UX Flows

## Beginner home
Three dominant starts: **Describe**, **Pick & Modify**, **Build from Shapes**. Secondary action: Import existing set.

## Beginner set flow
1. Create project and choose grid preset (default 24).
2. Choose visual language: outline/filled/duotone plus roundness and weight.
3. Add icons by library/search/import/shapes; later AI description.
4. Name icons semantically.
5. Set overview displays consistency warnings.
6. `Make Consistent` opens a change preview; never silently rewrites the set.
7. Preview in buttons/navigation/toolbar at 16/20/24/32px and light/dark.
8. Export wizard asks target, then advanced settings only when needed.

## Saving and durability
- Header shows a save state chip: `Saved to file` · `Saved in browser only` · `Saving…` · `Read-only (open in another tab)`.
- First project creation requests persistent storage; if denied, the chip explains the browser may clear data and offers "Save to file".
- `Ctrl/Cmd+S` saves to the bound file (File System Access) or downloads `.iconproj`. Reminder after 30 min of unsaved-to-file edits; never modal during a drag.
- Opening a project already open in another tab shows a read-only banner with **Take over editing** (the other tab flushes and becomes read-only).
- After a crash, reopening shows "Recovered N changes" with an option to inspect.

## Capability-aware controls
Beginner controls follow the capability matrix in `PRD.md` §5. Disabled controls show a one-line reason and, where applicable, the Expert alternative.

## Expert switch
Persistent project-level preference; mode switch is instantaneous. Expert mode reveals capabilities but does not convert the document.

## Expert workspace
Left: assets/layers/components. Center: vector canvas. Right: contextual inspector. Bottom dock: SVG, Recipe, Font, Preview, Validation, Code.

## Contextual inspector
Path: transform, geometry, fill, stroke, path. Group: transform, alignment, constraints. Icon: canvas/grid/semantics/variants. Project: design rules/tokens/export/versioning.

## Command palette
Searchable commands with keyboard shortcuts. Commands call the same application command layer as menus and automation.

## Batch workflow
Select icons → choose operation → `dryRun` in worker → show affected count, warnings, per-icon before/after thumbnails and a "not applicable" list with reasons → Apply as one undoable transaction (same `commandId` confirmation as automation).

## Font Lab
Glyph table, semantic name, code point, ligature, baseline, bearings, advance width, font metadata, validation. Beginner export auto-assigns PUA codepoints once and persists them (adding icons never renumbers). Glyph preview shows the **outlined** result (strokes expanded) next to the source, so users see exactly what the font contains. Dashed strokes and duotone layers are flagged before compile.

## Live SVG editor
Text edits are parsed in the import worker on idle (300 ms debounce). Valid edits apply as one `source.replaceIcon` transaction with node IDs preserved via `data-if-id` hints; invalid edits show inline diagnostics at line/column and never touch the canvas.

## Error philosophy
No opaque 'invalid SVG'. Show location, unsupported construct, security reason where relevant, and safe remediation. Preserve original input separately when import cannot be losslessly represented.

## Accessibility UX
Icon semantics: Decorative / Informative / Interactive asset. Meaningful icons require a suggested accessible name for generated framework examples. Decorative examples emit aria-hidden behavior.
