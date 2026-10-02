# Automation Contract: Command Layer, CLI, MCP, REST and WebMCP

The envelope, result, diagnostics and command registry are defined **only** in `specs/SCHEMAS.md` §6–7 (ADR-026). This document defines how each adapter exposes them.

## Principles
1. Adapters translate transport ↔ `CommandEnvelope`/query; they contain no business logic.
2. No adapter writes storage directly or bypasses validation, rules or security limits.
3. Adapters generate all IDs and `issuedAt` before dispatch; handlers are pure (ADR-018).
4. Mutations from non-interactive actors (`cli`, `mcp`, `webmcp`, `ai-proposal`) honour host confirmation policy. Default policy: batch or destructive commands require `dryRun: true` first, and the apply call must reference the dry-run's `commandId` via the envelope's `confirmsDryRun` within 10 minutes and at the same `expectedRevision`.
5. Every command and tool is versioned. Persisted projects never depend on an agent protocol for readability.

## Adapter matrix

| Surface | Status | Transport | Scope |
|---|---|---|---|
| In-app UI | V1 | direct dispatch on main thread → application layer | all commands |
| CLI | V1 (Phase 8) | Node.js process | queries, `compile.run`, `rule.validate`, scripted commands over `.iconproj` files |
| **MCP server** | V1 (Phase 8) — **primary agent surface** | stdio, launched as `iconforge mcp <project.iconproj>` | intention-level tools mapped 1:1 to commands/queries |
| WebMCP | Experimental, feature-flagged | `document.modelContext` (fallback `navigator.modelContext`), capability-detected | same tool set as MCP, registered only when the flag is on and the API exists |
| REST | Post-V1, with cloud | ASP.NET Core `/api/v1/projects/{id}/commands`, `/queries/{name}` | same envelope as JSON; OpenAPI generated from the JSON Schemas |

WebMCP is a Chrome-only origin trial whose entry point has already moved once; it cannot carry a product guarantee. The MCP server reuses the identical command layer through the CLI process and works with any MCP-capable host today.

## CLI
```text
iconforge validate  ./medical.iconproj [--format json|sarif] [--fail-on warning|error]
iconforge compile   ./medical.iconproj --profile web-svg --out ./dist [--check]   # --check: verify dist hashes match manifest
iconforge exec      ./medical.iconproj --command ./cmd.json [--dry-run]
iconforge migrate   ./old.iconproj --out ./new.iconproj
iconforge schemas   [--command <type>]
iconforge mcp       ./medical.iconproj [--read-only]
```
Exit codes: `0` success, `1` diagnostics at/above `--fail-on`, `2` invalid input, `3` internal error. `--format sarif` makes validation consumable by GitHub code scanning.

**Parity gate:** for every golden project, `iconforge compile` and the in-browser compiler (Chromium, Firefox, WebKit) produce byte-identical artifacts and manifest hashes.

## MCP tools (V1 set)
Coarse, intention-level, schema-described; never raw DOM or raw patches.

| Tool | Maps to | Mutating |
|---|---|---|
| `list_icons`, `get_icon`, `project_summary` | queries | no |
| `validate_project` | `rule.validate` | no |
| `import_svg` | import worker + `icon.importSvg` | yes |
| `create_icon_from_primitives` | `icon.add` | yes |
| `apply_set_style` | `set.applyStyle` (dry-run → confirm) | yes, batch |
| `apply_fix` | `rule.applyFix` | yes |
| `create_variant` | `variant.add` | yes |
| `compile_profile` | `compile.run` | no (writes artifacts to an output dir the host approved) |

`--read-only` registers only non-mutating tools. Tool descriptions are static text authored in the repository, never derived from project content (prevents prompt injection via icon names/metadata reaching tool definitions). Tool results containing user content are returned as data fields, not as instructions.

## REST (post-V1)
Authentication, tenancy, rate limiting and audit belong to the ASP.NET Core adapter. The server runs the same TypeScript core for compile/validate (Node worker sidecar or a WASM-hosted build) so that cloud artifacts satisfy the same parity gate; the .NET layer never re-implements geometry or rules.

## Compatibility
Breaking changes create a new command version; the previous version is accepted for one minor product release with a deprecation diagnostic.
