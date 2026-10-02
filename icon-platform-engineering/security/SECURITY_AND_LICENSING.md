# Security, Privacy and Licensing

## Trust model
Untrusted: SVG, fonts, ZIP/`.iconproj`, pasted source in the live SVG editor, AI output, MCP/WebMCP tool arguments, and (future) plugins. Trusted: repository code and pinned, hash-verified WASM modules.

## SVG import (ADR-025)
- Parsing runs in the import worker with a **non-DOM XML parser** (`DOMParser` is unavailable in workers). Any `<!DOCTYPE>`, entity declaration or processing instruction other than the XML declaration → reject.
- Allowlist AST → canonical model. Rejected: `script`, `on*` attributes, `foreignObject`, `image`, `style` elements with `@import`/`url()`, external `href`, `javascript:` and `data:` URLs (V1 accepts no data URLs anywhere in imported SVG), animation elements, `filter`, `mask` (reported, original preserved).
- `use`/`symbol`: expanded inline at import with max depth 8, max 2,000 expanded nodes, cycle detection.
- `clipPath` with simple shape children: converted by Boolean intersect with diagnostic `import.clip-flattened` (explicit lossy conversion, ADR-011); otherwise rejected with original preserved.
- Limits (defaults, configurable down not up): source ≤ 2 MB, ≤ 5,000 elements, ≤ 200,000 path-data characters per element, coordinates |v| ≤ 1e6, nesting ≤ 32, parse time ≤ 2 s (worker terminated on overrun).
- Imported content is **never** inserted into the live DOM. The canvas renders only from the canonical model via a project-owned renderer that sets attributes programmatically.

## Live SVG source editor
Same pipeline as import. Edits produce `source.replaceIcon` with ID hints (`data-if-id`) for reconciliation; hints are stripped in export.

## Archives
Before extraction: entry count ≤ 10,000; per-entry ≤ 20 MB; total uncompressed ≤ 200 MB; compression ratio ≤ 100:1 per entry; reject absolute paths, `..`, backslashes, drive letters, duplicate or case-colliding names, symlinks and nested archives. Streaming decompression aborts on limit breach.

## Fonts
Font *parsing* is only needed for verification and (post-V1) font import. Runs in a worker with byte/table/glyph limits. Names and metadata never influence filesystem paths.

## Content Security Policy (normative)
```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self' blob:;
worker-src 'self' blob:;
connect-src 'self' {configured AI/cloud origins only when enabled};
object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none';
require-trusted-types-for 'script'; trusted-types angular angular#bundler iconforge-preview;
upgrade-insecure-requests
```
`'wasm-unsafe-eval'` is required for WebAssembly compilation and is allowed; `'unsafe-eval'` and inline scripts are forbidden (Angular `autoCsp` hashes any inline bootstrap script; prefer none). **Accepted risk:** `style-src 'unsafe-inline'`. Angular injects component styles at runtime, and the shell is served from the service-worker cache, which makes per-response nonces either impossible or reused. CSS injection is mitigated by never rendering user markup (rule 12 of the agent instructions) and by Trusted Types. Revisit if Angular ships hash/constructable-stylesheet style injection. Font/demo previews use `blob:` URLs created from compiled bytes, inside a sandboxed `iframe` (`sandbox=""`, no scripts).

Additional headers: `Cross-Origin-Opener-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera/microphone/geolocation, HSTS. COEP is not required in V1 (no WASM threads / `SharedArrayBuffer`).

## AI and agent surfaces
Model output and tool arguments are untrusted structured input: schema-validate, clamp numeric ranges, bound node counts, run security and rule validation, preview, then require confirmation for mutation. Never execute generated code. MCP tool descriptions are static; project content is returned as data.

## Plugins (future)
Capability-based permissions, versioned SDK, isolated worker/iframe sandbox, no implicit network/filesystem access, explicit grants, signed distribution for enterprise.

## Local-first privacy
Core editing/compilation uploads nothing. Any cloud/AI action shows exactly what will be transmitted. Telemetry is opt-in, never contains artwork, path data, icon names or file names, and is limited to performance timings, error codes and anonymized feature counters.

## Licensing and provenance
Each icon retains source, author, SPDX licence (or `UNKNOWN`), attribution, original hash and modification status. Exports generate `LICENSES.txt` and `ATTRIBUTIONS.md`. Unknown licence is a warning in the export dialog. The built-in starter library contains only permissively licensed (MIT/ISC/Apache-2.0/CC0) or first-party icons with provenance pre-populated.

## Supply chain
- Lockfile-only installs (`pnpm install --frozen-lockfile`), Renovate/Dependabot PRs gated by the full suite.
- Dependency licence policy in CI (allowlist: MIT, ISC, BSD-2/3, Apache-2.0, MPL-2.0 for unmodified WASM modules, 0BSD, CC0); copyleft beyond that requires an ADR.
- CycloneDX SBOM per release; dependency and container scanning (e.g. OSV-Scanner, Trivy).
- WASM/native binaries pinned by SHA-256 and built reproducibly in CI from pinned Rust toolchains.
- Release artifacts and container images signed (Sigstore/cosign) with SLSA provenance attestations.
