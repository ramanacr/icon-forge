# icon-forge
Local-first icon-system platform: design consistent icon sets in Beginner or Expert mode, validate them against set-wide rules, and compile deterministically to SVG, sprites, PNG, ICO and icon fonts. Angular + TypeScript core, Rust/WASM geometry, CLI and MCP automation.

## Phase 1 browser editor

With Node 24 and pnpm 11, run `pnpm install --frozen-lockfile` and `pnpm --filter @iconforge/web start`. Open the local address printed by Angular. The current walking skeleton creates a project and icons, adds rectangles, ellipses and lines, selects and drags shapes with whole-unit snapping, groups layers, edits fill color and stroke width, undoes and redoes edits, saves each committed command to IndexedDB, and exports the active icon through the deterministic SVG profile compiler. Focus a layer and use the arrow keys to move it one icon unit at a time, or enter an exact X/Y position in the inspector. Grid and safe-area guides can be toggled without changing the export. A second tab opens read-only until you take over editing; a damaged journal tail offers explicit recovery of valid edits. The project list is local to this browser profile; export an SVG for a shareable artifact.

Run `pnpm --filter @iconforge/cli build` and `pnpm --filter @iconforge/web build` before `pnpm exec playwright test tests/web/m1.pw.ts --project=chromium`. The production build keeps the initial JavaScript shell below the documented 500 KB budget.

## Phase 1 SVG CLI preview

With Node 24 and pnpm 11, run `pnpm install --frozen-lockfile` and `pnpm --filter @iconforge/cli build`. Then compile a `.iconproj` with a saved SVG export profile:

```text
node apps/cli/dist/iconforge.mjs compile ./medical.iconproj --profile web-svg --out ./dist
node apps/cli/dist/iconforge.mjs compile ./medical.iconproj --profile web-svg --out ./dist --check
```

Compilation writes one SVG per icon and `manifest.json` into a new output directory. `--check` compares existing files with a fresh deterministic build and leaves them untouched. Phase 0 conformance gates remain open; see [implementation status](docs/IMPLEMENTATION_STATUS.md).
