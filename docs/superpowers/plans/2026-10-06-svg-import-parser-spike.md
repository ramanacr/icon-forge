# SVG Import Parser Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that untrusted SVG can be parsed in a bounded, terminable worker without DOM APIs, including safe local `use` expansion and rejection of the S-07 malicious corpus.

**Architecture:** `@iconforge/import-svg` owns a pure `parseSvgAst(source)` adapter backed by `saxes`, returning a bounded data AST without touching the DOM or project state. A separate module worker receives source text and replies with AST or a diagnostic. A browser entrypoint creates one worker per request and terminates it on success, error or timeout; canonical scene conversion and provenance writes follow in later Phase 2 slices.

**Tech Stack:** TypeScript 6.0, `saxes@6.0.0` (ISC) and `xmlchars@2.2.0` (MIT), Vitest, Playwright Chromium.

**Spec:** `icon-platform-engineering/security/SECURITY_AND_LICENSING.md` (SVG import), `icon-platform-engineering/testing/FIXTURE_CORPUS.md` (SVG import/security), `icon-platform-engineering/implementation/TECHNOLOGY_SPIKES.md` (S-07), ADR-011 and ADR-025 in `icon-platform-engineering/adrs/ADR_INDEX.md`.

## Global Constraints

- No `DOMParser`, `innerHTML`, network fetch, external references or script execution.
- Source ≤ 2 MB; elements ≤ 5,000; path `d` ≤ 200,000 characters each; coordinate magnitude ≤ 1e6; nesting ≤ 32.
- Local `use` expansion depth ≤ 8 and expanded nodes ≤ 2,000; reject cycles and missing references.
- Reject any DOCTYPE, entity declaration, or processing instruction other than the XML declaration.
- Browser worker timeout ≤ 2 seconds; the 2 MB accepted parse fixture must finish ≤ 300 ms on the target Chromium environment.
- No unsupported content may be silently converted into canonical project state. The spike returns an AST only.

## Review Focus

- A UTF-8 byte limit must not treat two-byte or four-byte characters as one byte; Task 1 tests the actual byte count.
- Namespace aliases for `href` must not evade external-reference rejection; Task 2 tests both `href` and `xlink:href`.
- Recursive `use` can grow exponentially without increasing source elements; Task 2 tests depth, cycles and fan-out count.
- A worker that never replies must be terminated and reported as timed out; Task 3 tests cleanup.
- Malformed numeric lists, non-finite values and coordinates beyond 1e6 must reject before the AST leaves the adapter; Task 2 tests each class.

---

### Task 1: Bounded XML reader

**Files:** Create `packages/import-svg/package.json`, `packages/import-svg/project.json`, `packages/import-svg/src/index.ts`, `packages/import-svg/src/xml-reader.ts`, `packages/import-svg/src/xml-reader.test.ts`; modify `pnpm-lock.yaml`.

**Interfaces:** Produce `readSvgXml(source: string): SvgElement` and `SvgElement { name: string; attributes: Record<string, string>; children: SvgElement[] }`. Reject with stable `import.*` error codes. This is parser output only, not a canonical icon.

- [x] Write failing tests for valid shapes; XML declaration; DOCTYPE, entity and non-XML processing instruction rejection; malformed XML; source bytes, element count, nesting and path length limits.
- [x] Run `pnpm exec vitest run packages/import-svg/src/xml-reader.test.ts` and confirm the new cases fail.
- [x] Implement `readSvgXml` with `saxes` events and counters that abort on limit breach; accept only a single `svg` root. Reject XML namespaces/attributes outside the SVG and xlink namespaces.
- [x] Run the focused tests, typecheck, the production licence gate and boundary lint; record the dependency licences in the change.
- [ ] Commit and push the parser boundary.

### Task 2: Safe AST and local `use` expansion

**Files:** Create `packages/import-svg/src/safe-ast.ts`, `packages/import-svg/src/safe-ast.test.ts`; modify `packages/import-svg/src/index.ts`.

**Interfaces:** Produce `parseSvgAst(source: string): SvgElement`, using Task 1's reader. The returned tree has expanded local `use` instances and no disallowed elements, attributes or URLs. It is still an import AST, not a project document.

- [ ] Write failing tests for safe primitives/groups, local `use`/`symbol`, cycle/depth/fan-out rejection, external and data URLs, event attributes, scripts, `foreignObject`, image, animation, mask/filter, unsafe styles, extreme coordinates and malformed numbers.
- [ ] Run focused tests and confirm failures.
- [ ] Implement allowlist checks and bounded `use` expansion, preserving source order and explicit diagnostics for unsupported constructs. Reject unsupported `clipPath` conversion at this stage rather than silently flattening it.
- [ ] Run focused tests, typecheck, lint and the malicious fixture corpus.
- [ ] Commit and push the safe AST boundary.

### Task 3: Terminable worker and browser spike

**Files:** Create `packages/import-svg/src/worker.ts`, `packages/import-svg/src/browser.ts`, `tests/import/s07.pw.ts`; update `docs/IMPLEMENTATION_STATUS.md` and `docs/BLOCKERS.md` only after evidence is available.

**Interfaces:** Produce `parseSvgInWorker(source: string, options?: { timeoutMs?: number }): Promise<SvgElement>`; the worker posts a success/error result and is always terminated. The public timeout never exceeds 2,000 ms.

- [ ] Write browser tests for worker-only execution under CSP, malicious corpus rejection, worker timeout/termination, and a generated 2 MB accepted SVG completing within 300 ms.
- [ ] Run the Chromium test to see the expected failure.
- [ ] Implement the module worker and browser wrapper with one-shot settlement and termination on every path.
- [ ] Run unit, typecheck, lint, browser fixture and bundle checks. Record measured size/time and deferred Firefox/WebKit verification without claiming the S-07 gate passed there.
- [ ] Commit and push the worker spike and evidence.
