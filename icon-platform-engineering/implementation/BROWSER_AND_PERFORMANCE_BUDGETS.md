# Browser Support and Performance Budgets

## Browser matrix
Current and previous major stable Chrome/Edge and Firefox are required browser targets. Playwright WebKit remains a required engine for cross-engine parity and smoke checks on the available Windows 11 test environment. Safari on macOS and iPadOS is an optional final device compatibility target; no Safari support is claimed until device testing is completed. Mobile phones: browse and preview only.

Required capabilities (detected at startup; missing → explicit message, never corruption): ES2022, Web Workers (module), WebAssembly, IndexedDB, Web Locks, `BroadcastChannel`, `CompressionStream` optional. File System Access API is progressive enhancement (download fallback). If a WASM module fails to load, the dependent export is disabled with a diagnostic; editing continues.

## Payload budgets (compressed, CI-enforced)
- Initial shell JS: ≤ 500 KB; initial CSS ≤ 60 KB.
- Lazy chunks: editor-core + Expert ≤ 350 KB; Paper.js adapter ≤ 120 KB; outline WASM ≤ 250 KB; resvg WASM ≤ 1.5 MB (loaded on first raster export or thumbnail cache); font compiler + WOFF2 WASM ≤ 700 KB.
- Service worker precaches the shell only; WASM is runtime-cached on first use.

## Performance budgets
Reference hardware: mainstream 4-core laptop, 8 GB RAM; measured p95 in Chromium, smoke-checked in Firefox/WebKit.

| Operation | Budget |
|---|---|
| Cold shell interactive (warm CDN, broadband) | ≤ 2.5 s |
| Open 100-icon project (modules loaded) | ≤ 1.0 s |
| Selection/transform feedback (icon < 250 segments) | 60 fps; never < 30 fps during drag |
| Command apply + undo/redo (single icon) | ≤ 50 ms |
| `set.applyStyle` dry-run, 100 icons | ≤ 500 ms (worker) |
| Validate 500 icons | ≤ 2 s (worker) |
| Compile 100 simple SVGs | ≤ 2 s |
| Rasterize one 512×512 icon | ≤ 250 ms |
| Outline one typical stroked icon | ≤ 15 ms |
| Font build, 200 glyphs, OTF + WOFF2 | ≤ 3 s |
| Import 2 MB SVG | ≤ 300 ms parse; hard timeout 2 s |
| Autosave flush | ≤ 30 ms main-thread time |
| Memory, 500 typical icons | ≤ 350 MB |
| Thumbnail grid, 500 icons | virtualized; ≤ 300 live SVG thumbnails, rest cached bitmaps |

## Correctness gates (CI, every PR touching core/compiler)
- Cross-engine parity: golden artifacts byte-identical across Node 24, Chromium, Firefox, WebKit.
- Replay: snapshot + journal reproduces byte-identical project.
- Durability: crash-mid-write and two-tab lock scenarios pass.

Budgets are CI benchmark gates with ±10 % tolerance; regressions beyond tolerance require a performance-waiver ADR.
