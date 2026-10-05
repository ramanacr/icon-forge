# Deferred verification and environment blockers

Phase 0 is still open. This log records work deferred because the current workspace lacks a required tool, browser, service, or device. It does not mark any technology spike as passed. The available local device is Windows 11. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the full list of unfinished implementation and fixture work.

| ID | Affected gate | Evidence in this workspace | Next pass |
| --- | --- | --- | --- |
| B-01 | S-01, S-02, S-04, S-05, S-06 cross-engine verification | Chromium is available at `/usr/bin/chromium`; Playwright Firefox and WebKit binaries are absent. Retried the pinned Playwright download on 2026-10-05 with a writable cache. All Firefox mirrors returned HTTP 403 `Domain forbidden` (`cdn.playwright.dev` and `playwright.download.prss.microsoft.com`), so installation stopped before WebKit. The system package index has no `firefox-esr` candidate. The CI workflow is configured for three engines but has not produced a verified run here. | Per user direction, defer Firefox/WebKit verification until the Windows 11 local environment is available. Run parity and durability suites there and record golden hashes and engine-specific failures. |
| B-04 | S-06 real native file picker | Chromium verifies the actual download fallback and archive round trip. Rechecked on 2026-10-05: this chat still executes on Linux at `/workspace/icon-forge`; its app terminal has no connected session, and no Windows terminal or mount is exposed. | Attach a local Windows session or checkout to this chat, then run the native picker and download fallback flows in Chrome or Edge on Windows 11; record observed behavior and recovery UX. |

## Resolved setup and specification blockers

| ID | Resolution | Still to implement or verify |
| --- | --- | --- |
| B-02 | Rust 1.99.0, Cargo, rustfmt, the `wasm32-unknown-unknown` target and `wasm-pack` 0.15.0 are installed under `/workspace/.cache`. `clang` is absent but is not needed for this Rust WASM target. The Rust/WASM outline adapter and Node/Chromium conformance fixtures now run. | No toolchain blocker remains. Finish integration with the font compiler and broaden the fixture corpus during Phase 0 work. |
| B-03 | npm registry access works. Rejected `woff2-encoder@2.0.0` because it requires JavaScript string evaluation. Pinned `woff2-encode-wasm@0.1.1` in the font package; lockfile records its tarball integrity. The encoder WASM SHA-256 is `749b5bd6a56b4e81e83de68470e7b60c2e535ad865cd21c4e22cef4f43f674c9`. Project OTF→WOFF2 output is deterministic, independently parsed by Fontkit, byte-identical in Node/Chromium, and loads with `FontFace` under CSP. Compiler bundle plus encoder WASM is about 395 KB gzip, below the 700 KB budget. | Complete the wider generated-font corpus and full S-08 round-trip verification. |
| B-05 | `ComponentV1.bindings` now maps declared parameters to a node's stroke width, radius or visibility. Validation checks parameter types, target compatibility and duplicate target fields. SVG export applies defaults and instance arguments to a copy; existing documents without bindings retain their schema shape, and parameterized documents without bindings still receive `svg.instance.parameters-unbound`. | Broaden the binding fixture corpus during Phase 0 conformance work. |

These are environment dependencies, not permission requests. Local work that does not depend on them continues. The Phase 1 gate remains S-01 through S-06 passing or a documented adapter swap that satisfies the same acceptance criteria.

## Conformance gap

| ID | Evidence | Next pass |
| --- | --- | --- |
| B-06 | The S-03 Chromium curved-stroke fixture compares the Rust/WASM outline to Canvas at 96 px. Its quadratic arch reaches raster IoU about 0.982 and cubic inflection about 0.986, below the required 0.995. At 384 px the quadratic reaches about 0.997 but the cubic remains about 0.986, so the cubic mismatch is not explained by the 96 px threshold alone. Bypassing `i_overlay` for one stroke made no measurable difference, locating the mismatch before union. Stroking a 128-segment sampled centerline with tiny-skia reached only about 0.983/0.979 at 96 px. Earlier increases in contour sampling and tiny-skia stroke resolution and an i_overlay polyline-stroker probe also failed. All probes were reverted and the original WASM rebuilt; the strict fixture remains an expected failure. | Review an alternative curve-stroking adapter against an independent geometric reference before another code change. The replacement must meet the 0.995 curved IoU, existing cap/join/hole fixtures, Node/browser parity, 15 ms p95 and 250 KB gzip budgets. Remove the expected-failure mark only after conformance passes. |
