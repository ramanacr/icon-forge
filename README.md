# icon-forge
Local-first icon-system platform: design consistent icon sets in Beginner or Expert mode, validate them against set-wide rules, and compile deterministically to SVG, sprites, PNG, ICO and icon fonts. Angular + TypeScript core, Rust/WASM geometry, CLI and MCP automation.

## Phase 1 SVG CLI preview

With Node 24 and pnpm 11, run `pnpm install --frozen-lockfile` and `pnpm --filter @iconforge/cli build`. Then compile a `.iconproj` with a saved SVG export profile:

```text
node apps/cli/dist/iconforge.mjs compile ./medical.iconproj --profile web-svg --out ./dist
node apps/cli/dist/iconforge.mjs compile ./medical.iconproj --profile web-svg --out ./dist --check
```

Compilation writes one SVG per icon and `manifest.json` into a new output directory. `--check` compares existing files with a fresh deterministic build and leaves them untouched. Phase 0 conformance gates remain open; see [implementation status](docs/IMPLEMENTATION_STATUS.md).
