# Detailed Wireframes and UI Design System

## Shell
Desktop-first responsive workspace with top command bar, left asset/layer rail, central canvas, right contextual inspector and optional bottom playground dock. Minimum supported editor viewport: 1024×700; below this, use a focused single-panel/tablet layout.

## Beginner mode
Top: project name, save-state chip, Beginner/Expert switch, Preview, Export.
Left: Search, Library, Shapes, Upload, AI (when enabled).
Center: SVG canvas with zoom, pan, selection and safe-area/grid overlays.
Right: human-language controls: Style, Weight, Roundness, Size, Padding, Align, Color.
Bottom: icon-set strip/grid and Add Icon.

Primary flow: New Set → choose grid/style → add/import icons → customize → consistency check → preview → export.

## Expert mode
Left: Layers / Components / Library.
Center: vector canvas with rulers, guides, node handles, snapping.
Right: Transform, Geometry, Fill, Stroke, Path, Metadata contextual inspector.
Bottom dock tabs: SVG, Paths, Font, Preview, Validation, Recipe.
Command palette: keyboard-first searchable command execution.

## Font Lab
Glyph table + search; glyph canvas; baseline/ascender/descender overlays; codepoint, glyph name, advance width, side bearings; auto-space and validate actions.

## Export dialog
Target cards: SVG, Sprite, PNG, ICO, Font, Project. Advanced options collapse by default. Always show file list preview, warnings (e.g. dashed strokes / duotone for fonts), licence attribution impact and estimated output size before Compile. Unavailable targets (WASM failed to load, spike-gated TTF) are shown disabled with a reason.

## Interaction rules
- Beginner and Expert mutate the same canonical document.
- Switching modes never converts or flattens geometry.
- Destructive/batch actions show dry-run diff when >1 icon is affected.
- All numeric expert fields support keyboard increment/decrement and direct expressions where safe.
- Undo/redo is global and transaction-based; a drag is one transaction.
- Controls that cannot apply to the selection are disabled with a reason, never approximated.
- Errors identify object + rule + remediation; never generic "invalid icon".

## Design tokens
Use CSS custom properties and semantic tokens, not literal component colors. Required groups: surface, text, border, accent, danger, warning, success, selection, focus, canvas/grid, spacing, radius, typography, elevation and motion.

## Accessibility
WCAG 2.2 AA target. Complete keyboard access, visible focus, semantic buttons/menus/dialogs, accessible canvas object list, reduced-motion support, non-color-only diagnostics and minimum 44×44 touch targets on touch layouts.
