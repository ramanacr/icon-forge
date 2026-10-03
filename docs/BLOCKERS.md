# Deferred verification and environment blockers

Phase 0 is still open. This log records work deferred because the current workspace lacks a required tool, browser, service, or device. It does not mark any technology spike as passed. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the full list of unfinished implementation and fixture work.

| ID | Affected gate | Evidence in this workspace | Next pass |
| --- | --- | --- | --- |
| B-01 | S-01, S-02, S-04, S-05, S-06 cross-engine verification | Chromium is available at `/usr/bin/chromium`; Playwright Firefox and WebKit binaries are absent. A prior browser download attempt could not complete. The CI workflow is configured for three engines but has not produced a verified run here. | Install Playwright Firefox/WebKit on a runner with access, run all parity and durability suites, and record golden hashes and any engine-specific failures. |
| B-02 | S-03 stroke outlining | `rustc`, `cargo`, `clang`, and `wasm-pack` are unavailable in this workspace. No Rust/WASM outline engine or conformance result exists. | Provision the Rust/WASM toolchain, implement the `IOutlineEngine` candidate, and run cap, join, miter, overlap, winding, size, and timing fixtures. |
| B-03 | S-08 WOFF2 and the S-05 OTF+WOFF2 baseline | Installing the candidate `woff2-encoder@2.0.0` was stopped after npm registry requests returned HTTP 503. No encoder was added to the lockfile. | Restore registry access, inspect and pin a mature WASM encoder and its hash, then verify deterministic round-trip, CSP behavior, browser loading, and bundle size. |
| B-04 | S-06 Safari installation behavior and native picker | This Linux workspace cannot verify Safari's installed/noninstalled behavior or a real native file picker. Chromium verifies the actual download fallback and archive round trip. | Run device-level Safari scenarios and real picker flows; record observed behavior and recovery UX. |

These are environment dependencies, not permission requests. Local work that does not depend on them continues. The Phase 1 gate remains S-01 through S-06 passing or a documented adapter swap that satisfies the same acceptance criteria.
