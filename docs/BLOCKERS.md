# Deferred verification and environment blockers

Phase 0 is still open. This log records work deferred because the current workspace lacks a required tool, browser, service, or device. It does not mark any technology spike as passed. The available local device is Windows 11. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the full list of unfinished implementation and fixture work.

| ID | Affected gate | Evidence in this workspace | Next pass |
| --- | --- | --- | --- |
| B-01 | S-01, S-02, S-04, S-05, S-06 cross-engine verification | Chromium is available at `/usr/bin/chromium`; Playwright Firefox and WebKit binaries are absent. Retried both downloads on 2026-10-04 with writable caches. The proxy returned HTTP 403 `Domain forbidden` for `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`. The CI workflow is configured for three engines but has not produced a verified run here. | Per user direction, defer Firefox/WebKit verification until the Windows 11 local environment is available. Run parity and durability suites there and record golden hashes and engine-specific failures. Playwright WebKit checks are distinct from Safari device checks. |
| B-04 | S-06 real native file picker | This Linux workspace cannot verify a real native file picker. Chromium verifies the actual download fallback and archive round trip. | Run the native picker and download fallback flows in Chrome or Edge on Windows 11; record observed behavior and recovery UX. |

## Resolved setup blockers

| ID | Resolution | Still to implement or verify |
| --- | --- | --- |
| B-02 | Rust 1.99.0, Cargo, rustfmt, the `wasm32-unknown-unknown` target and `wasm-pack` 0.15.0 are installed under `/workspace/.cache`. `clang` is absent but is not needed for this Rust WASM target. The Rust/WASM outline adapter and Node/Chromium conformance fixtures now run. | No toolchain blocker remains. Finish integration with the font compiler and broaden the fixture corpus during Phase 0 work. |
| B-03 | npm registry access works. Rejected `woff2-encoder@2.0.0` because it requires JavaScript string evaluation. Pinned `woff2-encode-wasm@0.1.1` in the font package; lockfile records its tarball integrity. The encoder WASM SHA-256 is `749b5bd6a56b4e81e83de68470e7b60c2e535ad865cd21c4e22cef4f43f674c9`. Project OTF→WOFF2 output is deterministic, independently parsed by Fontkit, byte-identical in Node/Chromium, and loads with `FontFace` under CSP. Compiler bundle plus encoder WASM is about 395 KB gzip, below the 700 KB budget. | Complete the wider generated-font corpus and full S-08 round-trip verification. |

These are environment dependencies, not permission requests. Local work that does not depend on them continues. The Phase 1 gate remains S-01 through S-06 passing or a documented adapter swap that satisfies the same acceptance criteria.

## Optional final device check

Safari on macOS or iPadOS, including installed and noninstalled behavior, may be checked if a device becomes available. It is not required for Phase 0 or Phase 1 and is not a blocker for the Windows 11 workflow. Playwright WebKit remains part of the required cross-engine suite.

## Specification gap

| ID | Evidence | Pending decision |
| --- | --- | --- |
| B-05 | `SCHEMAS.md` says component parameters bind to stroke width, radius and visibility, but `ComponentV1` contains only parameter declarations, literal scene nodes and instance arguments. It has no field mapping a parameter to a node property. Static component instances and variants render; the serializer reports `svg.instance.parameters-unbound` for parameterized components. | Add an explicit, validated binding representation to the project schema and its migration rules before applying instance arguments during export. |

## Conformance gap

| ID | Evidence | Next pass |
| --- | --- | --- |
| B-06 | The S-03 Chromium curved-stroke fixture compares the Rust/WASM outline to Canvas at 96 px. Its quadratic arch reaches raster IoU about 0.982 and cubic inflection about 0.986, below the required 0.995. Raising contour sampling from 16 to 64 steps and tiny-skia stroke resolution from 1 to 4 did not materially improve it. A temporary i_overlay polyline-stroker probe was worse (about 0.980 and 0.974); its code was reverted. The strict fixture remains an expected failure for Chromium. | Investigate curve stroking or raster boundary differences with a geometric reference; repair the adapter or record an S-03 adapter swap. Remove the expected-failure mark only after both cases pass 0.995. |
