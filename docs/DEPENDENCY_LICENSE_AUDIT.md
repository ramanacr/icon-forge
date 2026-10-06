# Development dependency licence audit

Checked on 2026-10-06 with the pinned pnpm lockfile and `pnpm licenses list --json`. The existing CI check uses `--prod` and passes its 20 reported production packages. The complete installed tree has these entries outside the policy in `icon-platform-engineering/security/SECURITY_AND_LICENSING.md`:

| Licence | Packages and versions | Dependency path / role |
| --- | --- | --- |
| MPL-2.0 | `axe-core@4.13.0` | Direct development dependency for accessibility tests. |
| MPL-2.0 | `lightningcss@1.33.0`, `lightningcss-linux-x64-gnu@1.33.0` | Vite through Angular build and Vitest; CSS build tooling. |
| Python-2.0 | `argparse@2.0.1` | `js-yaml` through ESLint; `@zkochan/js-yaml` through Nx. |
| CC-BY-4.0 | `caniuse-lite@1.0.30001814` | Browserslist through Angular build and Babel. |
| CC-BY-3.0 | `spdx-exceptions@2.5.0` | SPDX parser through npm package tooling (`pacote`). |
| BlueOak-1.0.0 | `chownr@3.0.0`, `glob@13.0.6`, `isexe@4.0.0`, `lru-cache@11.5.3`, `minimatch@10.2.5`, `minipass@7.1.3`, `minipass-flush@1.0.7`, `path-scurry@2.0.2`, `tar@7.5.22`, `yallist@5.0.0` | Build, schema generation and npm package tooling; `glob` is directly reachable through `ts-json-schema-generator`. |

`@resvg/resvg-wasm@2.6.2` is also reported as MPL-2.0 but is the existing, explicitly permitted unmodified WASM-module exception. The entries above are development-only according to the production licence report. That distinction does not itself amend the documented allowlist, which does not exempt development tools.

The build stack currently requires Angular, Vite/Vitest, Nx, ESLint and schema generation, so changing one top-level package would not remove all of these paths. B-07 remains open. A decision must either replace each disallowed dependency with allowed-licence equivalents or record an ADR that explicitly defines how non-shipped development tools are treated, including the MPL-2.0 tools, before the full installed tree can be called compliant. Keep the production gate active in the meantime; do not represent it as a full-tree pass.
