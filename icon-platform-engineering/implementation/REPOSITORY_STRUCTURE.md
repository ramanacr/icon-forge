# Repository Structure

```text
/apps
  /web                  # Angular 22: Beginner + Expert + PWA
  /cli                  # Node 24 CLI + `iconforge mcp` stdio server
  /api                  # ASP.NET Core / .NET 10 — created only in the cloud phase
/packages
  /project-model        # types, generated JSON Schemas, quantization, canonical serializer, migrations
  /commands             # pure handlers, patch + inverse-patch generation
  /application          # dispatcher, history, revision/concurrency, confirmation policy, queries
  /geometry             # matrices, bounds, hit-test, snapping, IGeometryEngine contract
  /geometry-paper       # Paper.js adapter (bootstrap)
  /outline              # IOutlineEngine contract + TS binding to outline WASM
  /editor-core          # selection, gestures→transactions, preview layer (no Angular)
  /rules                # validators, rule registry, fix proposals
  /svg-import           # IXmlReader adapter, allowlist, canonicalizer, diagnostics
  /compiler-core        # stage graph, manifest, determinism utilities
  /export-svg           # serializer + sprite
  /export-raster        # IRasterizer (resvg)
  /export-ico           # project-owned ICO encoder
  /export-font          # IFontCompiler, cu2qu, IWoff2Encoder
  /archive              # IArchiveService (fflate), .iconproj reader/writer
  /persistence          # IProjectRepository, Dexie adapter, FS Access adapter, journal, locks
  /automation           # MCP tool definitions, WebMCP adapter, command discovery
  /workers              # worker entry points + typed RPC
  /security             # limits, URL/attribute policies, shared validators
  /recipes              # Phase 9 (empty package with contract stub)
  /plugin-sdk           # contracts only; runtime deferred
  /test-fixtures        # corpus + generators
/crates
  /outline-wasm         # stroke expansion, overlap removal, winding normalization
  /geometry-wasm        # strategic Boolean engine
  /font-wasm            # optional, only if S-05 fails
/tests
  /golden  /parity  /security  /performance  /e2e  /replay
/deploy
  /web                  # Dockerfile, nginx.conf (headers/CSP), compose for local prod-like run
  /api                  # later
/docs
  (this package: adrs/, specs/, …)
```

## Workspace rules
pnpm workspaces + Nx. Every project carries tags `scope:{core|infra|ui|automation|cloud}` and `type:{model|lib|adapter|app}`; `@nx/enforce-module-boundaries` encodes the dependency direction below and fails CI on violation. Rust crates build to versioned WASM packages (hash-pinned) consumed only through TS adapters.

## Dependency direction
```text
app(web) ─► application ─► commands ─► project-model
   │             │              └────► geometry (contracts)
   │             └► rules, compiler-core (contracts)
   └► editor-core ─► application
adapters (geometry-paper, outline, export-*, persistence, svg-import, archive) ─► contracts only
automation ─► application        cli ─► application + adapters
```
`project-model` imports nothing else from the repo. Geometry does not know persistence. Automation does not know DOM. The cloud API consumes compiled core via a Node sidecar; it never re-implements domain rules.
