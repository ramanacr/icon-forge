# Deployment and Operations

## V1 topology
V1 is a static PWA plus a downloadable CLI. There is no server-side state.

```text
Browser ──HTTPS──► CDN ──► origin: OCI image (unprivileged Nginx, immutable assets)
Developer/CI ──► npm package `@iconforge/cli` (CLI + MCP stdio server)
```

## Web container
- Multi-stage build: `node:24-*` builder (pnpm, frozen lockfile, `nx build web --configuration=production`) → `nginxinc/nginx-unprivileged:*-alpine` runtime pinned by digest.
- Runs as non-root, read-only root filesystem, `tmpfs` for Nginx temp paths, no shell-dependent entrypoint, healthcheck endpoint `/healthz` (static).
- Caching: hashed assets `Cache-Control: public, max-age=31536000, immutable`; `index.html`, `ngsw.json`, `manifest.webmanifest` `no-cache`.
- MIME: `application/wasm` for `.wasm` (required for streaming compilation).
- Headers per `security/SECURITY_AND_LICENSING.md` (CSP with `'wasm-unsafe-eval'`, Trusted Types, COOP, HSTS, nosniff, Referrer-Policy, Permissions-Policy), set statically in `nginx.conf`. No per-response nonces: the shell is service-worker cached, so the CSP is hash/`'self'`-based for scripts by design.
- Image signed with cosign; SBOM and provenance attached.

## CI/CD (GitHub Actions)
1. `affected` lint/typecheck/unit (Nx cache, remote cache optional).
2. Rust: `cargo fmt/clippy/test`, reproducible WASM build, hash check against committed pins.
3. Conformance: geometry/outline/font/raster suites.
4. Cross-engine parity + replay + durability (Playwright: Chromium, Firefox, WebKit; Node).
5. Security: malicious corpus, dependency + licence policy, container scan, secret scan.
6. Performance + bundle budgets.
7. Build image, generate SBOM, sign, push; deploy to preview environment per PR.
8. Release: tag → CLI npm publish with provenance, image promotion to production, changelog.

## Release and versioning
SemVer for the app, CLI and `compilerVersion`. Any change to compiler output bytes is at least a minor version and requires regenerated goldens with reviewer sign-off. Service worker update flow: prompt user to reload; never reload with unsaved-to-file changes without confirmation.

## Observability (V1, privacy-preserving)
- Client: local structured log ring buffer + performance marks; user-initiated support bundle (reviewed before sending; no artwork).
- Opt-in telemetry: performance timings, error codes, feature counters only. Endpoint is a minimal collector; can be disabled at build time for air-gapped deployments.
- Edge: standard CDN/Nginx access logs without query strings.

## Cloud phase (post-V1, ASP.NET Core / .NET 10)
- Containers: `mcr.microsoft.com/dotnet/aspnet:10.0` chiseled/non-root runtime; health checks (`/health/live`, `/health/ready`); OpenTelemetry traces/metrics/logs via OTLP.
- Compile/validate executes the TS core in a Node sidecar or worker service so cloud artifacts satisfy the same parity gate.
- PostgreSQL for metadata; S3-compatible storage for content-addressed `.iconproj` blobs and build artifacts; outbox pattern for publish events.
- AuthN via OIDC; per-tenant isolation enforced in the API adapter, never in the core.
