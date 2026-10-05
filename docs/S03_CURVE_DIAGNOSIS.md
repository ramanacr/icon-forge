# S-03 curved-stroke raster diagnosis

The Chromium S-03 fixture compares a filled stroke outline with Canvas rendering of the original stroke. Both are drawn at a 24-unit viewBox into a 96 px canvas, with alpha greater than 127 treated as covered. The required raster IoU is at least 0.995. The current outline remains a strict expected failure.

## Stage isolation

On 2026-10-05, the existing two fixtures were rendered at 96 and 384 px. A temporary diagnostic exported the stroke path directly from tiny-skia *before* the production `flatten` and `i_overlay` stages. It also compared Kurbo 0.13.1's native Bézier output and an independently sampled normal-offset polygon. The probes were removed after measurement; production code and the 0.995 gate were not changed.

| Representation compared with Canvas stroke | Quadratic, 96 px | Cubic, 96 px | Quadratic, 384 px | Cubic, 384 px |
| --- | ---: | ---: | ---: | ---: |
| Same source path as SVG stroke | 1.000 | 1.000 | 1.000 | 1.000 |
| Production quantized outline, filled | 0.982 | 0.986 | 0.997 | 0.986 |
| Raw WASM polygon before TypeScript quantization, filled | 0.982 | 0.986 | 0.997 | 0.986 |
| Tiny-skia expanded path with native quadratic segments, filled | 1.000 | 0.988 | 1.000 | 0.986 |
| Kurbo expanded path with native cubic segments, filled | 0.977 | 0.982 | 0.992 | 0.993 |
| Dense sampled normal-offset polygon, filled | 0.982 | 0.980 | 0.994 | 0.993 |

The raw WASM polygon and quantized adapter produce the same 96 px classifications, ruling out canonical quantization as the cause. Earlier bypassing of `i_overlay` for a single stroke did not change the scores, ruling out the union stage for these fixtures. Increasing flattening density alone also failed to meet the gate.

The quadratic's tiny-skia stroke **does** rasterize identically when its quadratic outline segments are preserved. The production flattening step replaces those smooth boundaries with lines and causes the 96 px failure. This is a confirmed loss of raster fidelity at the curve-to-polygon conversion boundary.

The cubic remains below 0.995 even when tiny-skia's expanded quadratic segments are preserved. Kurbo's native cubic outline and a 1,024-step analytic normal-offset polygon also miss the 96 px gate. The cubic has no zero tangent or offset cusp: its sampled minimum radius of curvature is about 2.78 units, larger than the 1-unit stroke radius. It is not a degenerate fixture.

As a separate geometry check, Canvas `isPointInPath` on the raw outline and `isPointInStroke` on the source curve agreed at more than 0.995 IoU for pixel-center samples at both 96 and 384 px; the cubic exceeded 0.997 at both sizes. At 384 px, 190 of the 202 cubic pixels that differed in raster classification had the same class for both shapes under 8×8 subpixel point sampling; the average difference in sampled coverage was about 0.017. This localizes the remaining mismatch to the boundary rasterization of an expanded fill versus a native stroke, plus any offset-curve approximation that affects boundary coverage. Point-membership agreement alone cannot prove exact equality of continuous shapes or identify which rasterizer is more accurate.

## Consequence

Preserving Bézier outline segments fixes the quadratic fixture in the isolated probe; the tested flattening approaches do not. It is insufficient for the cubic fixture with either tested stroker. A replacement must be judged using the unchanged 96 px Canvas raster gate, plus the existing cap, join, hole, overlap, determinism, performance and bundle-size gates. The threshold should not be relaxed to conceal this difference. The next spike should focus on a curve-preserving offset and its boundary coverage against the cubic fixture before integrating it with overlap removal and winding normalization.
