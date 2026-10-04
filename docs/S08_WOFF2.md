# S-08 WOFF2 encoder decision

Selected `woff2-encode-wasm@0.1.1` for the `IWoff2Encoder` role. The package wraps Google's WOFF2 encoder in a standalone WASM asset. Its tarball integrity is pinned in `pnpm-lock.yaml`, and the installed `encoder.wasm` SHA-256 is `749b5bd6a56b4e81e83de68470e7b60c2e535ad865cd21c4e22cef4f43f674c9`.

Rejected `woff2-encoder@2.0.0` after a no-string-evaluation Node probe failed during its Emscripten binding initialization. That dependency would require JavaScript `unsafe-eval`, which conflicts with the browser CSP. The selected encoder passed the same probe.

The adapter builds canonical OTF/CFF data first, then encodes it to WOFF2. Tests verify repeatable bytes, independent Fontkit decoding with matching glyph paths and GSUB ligatures, Node/Chromium byte parity, Chromium `FontFace` loading and raster IoU ≥ 0.98 under a CSP that permits WASM compilation but excludes JavaScript `unsafe-eval`. The browser font compiler bundle is about 65 KB gzip and the encoder WASM about 330 KB gzip, within the combined 700 KB budget. A 200-glyph OTF+WOFF2 build met the 3-second Chromium budget.

Firefox and WebKit loading checks are deferred to the local environment per user direction. The full font pipeline remains gated by S-05 and the compiler integration work in `IMPLEMENTATION_STATUS.md`.
