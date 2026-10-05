# Technology Spikes

Each spike is time-boxed, produces an executable test suite that stays in the repo as a conformance suite, and ends with an ADR note (accept / swap adapter). Spikes S-01…S-06 are **Phase 0 exit gates**; the rest gate their phase.

| ID | Capability | Candidate | Time-box | Acceptance |
|---|---|---|---|---|
| S-01 | Cross-engine determinism | Quantization + canonical serializer | 3 d | Golden corpus produces byte-identical JSON and SVG in Node 24, Chromium, Firefox, WebKit; journal replay byte-identical; fast-check property tests on quantize/serialize round-trip. |
| S-02 | Boolean ops | Paper.js headless in a Web Worker | 5 d | Runs in worker without DOM/canvas; union/subtract/intersect/exclude over geometry corpus; no input mutation; coincident/touching/near-degenerate cases either correct (IoU ≥ 0.999 vs reference raster) or diagnosed; output quantized; bundle ≤ 120 KB gz lazy. Failure → evaluate Rust candidates. |
| S-03 | Stroke outlining + overlap removal | Rust/WASM (Skia-derived stroker class) | 8 d | All cap/join/miter combinations, closed/open, cusps, tiny segments; raster IoU vs browser-rendered stroke ≥ 0.995 at 96 px; winding normalized; ≤ 15 ms per typical icon; WASM ≤ 250 KB gz. |
| S-04 | Rasterization | resvg WASM in worker | 3 d | 16–512 px goldens; alpha correct; identical bytes across browsers + Node; 512 px ≤ 250 ms. |
| S-05 | Font build | opentype.js (CFF) + cu2qu → `glyf` | 6 d | `.notdef`, space, PUA cmap, ligatures incl. input glyphs, names; OTF and TTF parse with an independent reader; load via `FontFace` in all three engines; glyph raster IoU ≥ 0.98 vs SVG at 48 px; deterministic bytes. Failure of `glyf` path → ship OTF+WOFF2 only in V1 and evaluate a Rust font writer. |
| S-06 | Storage durability & locking | Dexie + Web Locks + FS Access | 4 d | 2,000-icon project save/load; quota-exceeded handling; crash mid-write recovery; two-tab lock/takeover; persistence status detection in Playwright Chromium, Firefox and WebKit; native file picker and download fallback checked on Windows 11. |
| S-07 | SVG import parser | saxes-class parser in worker | 3 d | Full malicious corpus rejected; DOCTYPE rejected; `use` expansion limits; 2 MB parse ≤ 300 ms; worker termination on timeout. |
| S-08 | WOFF2 encoder | WASM encoder | 2 d | Round-trip decode; CSP-safe (only `'wasm-unsafe-eval'`); pinned hash; deterministic bytes. |
| S-09 | ZIP | fflate | 2 d | Deterministic bytes; zip-slip/bomb corpus; streaming limits. |
| S-10 | WebMCP (optional) | `document.modelContext` | 2 d | Tools register/unregister behind flag; graceful absence; same results as MCP adapter. Non-blocking. |

## Rule
No third-party type crosses an adapter boundary. A library is accepted only after fixture, security, bundle-size, determinism and performance tests pass.
