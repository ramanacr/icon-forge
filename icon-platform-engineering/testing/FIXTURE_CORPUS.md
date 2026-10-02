# Test Fixture Corpus

The repository MUST contain redistributable fixtures created in-house or with compatible licenses. Every fixture includes expected diagnostics and/or golden output hashes.

## Geometry
`rect-circle-overlap`, `nested-holes`, `touching-edges`, `coincident-edges`, `compound-path`, `open-path-rejected`, `self-intersection`, `tiny-segments`, `large-coordinates`, `transformed-groups`, `evenodd-vs-nonzero`.

## Determinism and replay
`rotate-15deg`, `rotate-arbitrary`, `arc-to-cubic`, `scale-non-uniform`, `quantize-half-even-boundary`, `negative-zero`, `large-project-serialize`. Each has golden JSON + SVG hashes that must match in Node 24, Chromium, Firefox and WebKit. Replay fixtures: snapshot + journal of 1, 200, 5,000 commands ⇒ byte-identical project; journal with corrupt tail ⇒ truncated + reported.

## Outline engine
Every cap × join combination; miter-limit boundary; open and closed paths; cusps; 180° reversals; zero-length segments with round caps (dots); overlapping strokes in one icon; strokes over fills; evenodd source; dashed stroke ⇒ `font.dash-unsupported`.

## SVG import/security
Valid: primitive shapes, paths, groups, transforms, currentColor, viewBox, `use`/`symbol` within limits, arcs (converted + diagnosed), simple clip-path (flattened + diagnosed).
Reject/sanitize: script, event attributes, javascript/data URLs, foreignObject, image, external refs, `style` with `@import`/`url()`, any DOCTYPE/entity (billion-laughs, external entity), `use` cycles and fan-out bombs, mask/filter (rejected, original preserved), extreme element/path count, extreme coordinates/path-data length, malformed numbers, parse-time exhaustion (worker timeout).

## Compiler
Golden sets: 1-icon minimal, 24-icon outline, filled, duotone, tokenized colors, Unicode names, deterministic ordering. Validate SVG parseability, PNG dimensions/alpha, ICO frame table, font cmap/glyph metrics and manifest hashes.

## Font
`.notdef`, `space`, PUA E000/E001 mapping, stable re-numbering when an icon is added, ligature mapping **with input-glyph coverage**, empty glyph, compound contour, nested holes (winding), extreme bearings, duplicate codepoint rejection, invalid/long family-name sanitization, duotone ⇒ error unless merge enabled, cu2qu tolerance (max deviation ≤ upem/1000), OTF/TTF/WOFF2 parse by independent reader, browser `FontFace` load in all engines.

## Project/migrations
Empty v1, representative v1, previous-minor migration, unknown extension namespace (preserved), unknown field outside `extensions` (rejected), corrupt archive, duplicate IDs, missing references, instance cycle, unquantized coordinate (rejected with diagnostic), oversized project.

## UX/E2E scenarios
Beginner: new set → five icons → style → validate → SVG export.
Expert: import → node edit → Boolean → SVG source edit → mode switch → undo/redo.
Font Lab: assign codepoints → compile → browser demo renders all glyphs.
Recovery: autosave → simulated crash → journal replay.
Concurrency: same project in two tabs → second is read-only → takeover → first becomes read-only, no lost writes.
Durability: persistence denied → warning chip; storage cleared → project restored from `.iconproj` file.
Parity: CLI `compile --check` against browser-produced build manifest.

## Scale fixtures
100, 500 and 2,000 icon generated corpora for virtualization, validation and compiler benchmarks. Large/malicious fixtures are generated during tests rather than committed when size is excessive.
