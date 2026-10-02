# Compiler and Export Specification

## Pipeline
```text
validate source
 → resolve variants / components / tokens          (pure, TS)
 → materialize geometry (quantized)                (pure, TS)
 → target transforms
     ├─ vector targets (SVG, sprite): serialize directly
     ├─ raster targets (PNG, ICO): IRasterizer
     └─ font target: IOutlineEngine → IFontCompiler → IWoff2Encoder
 → validate target (decode/re-parse every artifact)
 → package (IArchiveService, deterministic)
 → manifest + hashes
```
Every stage is a pure function of `(project snapshot, profile, compilerVersion)`. Stages run in a compiler worker. A stage failure yields diagnostics and no partial package.

## Determinism rules (ADR-018)
- Input geometry is already quantized; stages use only arithmetic and quantization (no transcendental math).
- Output order: icons by `name` (code-point order), variants by `name`, files by path (code-point order).
- No timestamps, random values, locale-dependent formatting or environment data in artifacts. ZIP entries use a fixed DOS time of `1980-01-01T00:00:00`, fixed permissions, no extra fields.
- WASM modules are pinned by hash; their version is part of `compilerVersion`.
- Parity: byte-identical across Node CLI, Chromium, Firefox and WebKit (CI gate).

## SVG
Project-owned serializer from canonical geometry; no general-purpose SVG optimizer in the pipeline (optimizer output varies by version and can change semantics). Clean `viewBox`; optional `width/height`; precision 0–3 decimals with segment-level rounding that never collapses a closed subpath; paint mode `currentColor` | CSS variables (`var(--if-<token>)`) | resolved colours; `role="img"` + `<title>` for informative icons, `aria-hidden="true"` for decorative; optional `<metadata>` provenance. Never emits scripts, event attributes, `foreignObject` or external references. Every output is re-parsed through the importer as a self-check.

## SVG sprite
One `<symbol id="{prefix}{name}">` per icon/variant; IDs derived from slugs (collision → compile error, not suffixing). Includes `usage.html` and manifest.

## PNG
Explicit size list; transparent background; theme selects token values; rendered by `IRasterizer` (resvg WASM) in a worker. Output is PNG with no time chunk, fixed compression level.

## ICO
Sizes from {16, 24, 32, 48, 64, 128, 256}. Entries ≤ 48 px as 32-bit BMP/DIB with AND mask for maximum compatibility; 64–256 px as embedded PNG. Directory entries validated; the file is decoded in tests and each frame compared to the PNG golden.

## Icon fonts
### Outline stage (`IOutlineEngine`, ADR-022)
Fonts carry only filled contours. Before font compilation each icon is converted:
1. Expand strokes to fills honouring width, cap, join and miter limit. Dashed strokes → error `font.dash-unsupported`.
2. Union all filled geometry of the icon (overlap removal).
3. Normalize winding (outer contours one direction, holes opposite) for the target flavour; resolve `evenodd` into nonzero-equivalent contours.
4. Drop degenerate contours below `QUANTUM` area; report as info.
5. Map viewBox → font units: `scale = unitsPerEm / grid.height`; y-flip; baseline at `descender = −round(0.125 × unitsPerEm)` unless overridden.
Opacity and duotone `secondary` layers are not representable in a monochrome glyph: compile fails with `font.duotone-unsupported` unless the font profile sets `options.mergeLayers: true`. When the option is absent, it is `false`.

### Font compilation (`IFontCompiler`, ADR-023)
- Required glyphs: `.notdef` (with outline), `space` (U+0020).
- Codepoints: Beginner auto-assigns from `puaStart` (default U+E000) in icon-name order, stable across builds once assigned (assignment is persisted via `icon.updateMetadata`, so adding an icon never renumbers existing ones). Duplicates are compile errors.
- Ligatures (optional): for each icon name, a GSUB ligature from its characters to the glyph. The font **must** also map every character used in any ligature name (`a–z`, `0–9`, `-`, `_`) to zero-contour glyphs with a defined advance; otherwise ligatures do not trigger.
- Advance width = `unitsPerEm` unless overridden; bearings from icon font metadata.
- Name table derived from profile `family` (sanitized ASCII, ≤ 31 chars for family name ID 1).
- Formats: **OTF (CFF outlines)** and **WOFF2** are the V1 baseline. **TTF (`glyf`, quadratic)** is produced via cubic→quadratic conversion (cu2qu, max error `unitsPerEm/1000`) and ships only if spike S-05 passes. A `.ttf` extension is never applied to CFF data.
- Outputs: font files, `icons.css` (`@font-face` + classes), `demo.html`, `manifest.json` (name ↔ codepoint ↔ glyph), `LICENSES.txt`, `ATTRIBUTIONS.md`.
- Verification: parse with an independent reader; load in a headless browser page and compare each glyph raster to the SVG raster (IoU ≥ 0.98 at 48 px).

## Framework packages (post-V1)
React/Angular/Vue/Web Component generators consume compiled SVG output, never editor internals. Accessible decorative/informative APIs, tree-shakeable exports, TypeScript declarations.

## Export profiles
Profiles are data (`ExportProfileV1`), invocable from UI, CLI and MCP.

## Build manifest
```json
{
  "format": "iconforge-build", "formatVersion": 1,
  "projectContentSha256": "…", "compilerVersion": "1.4.0+wasm.resvg-<hash>.woff2-<hash>",
  "profile": { "name": "web-font", "optionsSha256": "…" },
  "artifacts": [{ "path": "fonts/icons.woff2", "sha256": "…", "bytes": 18234 }]
}
```
No timestamp inside the hashed manifest. An optional sidecar `build-info.json` may record wall-clock time and is excluded from determinism checks.
