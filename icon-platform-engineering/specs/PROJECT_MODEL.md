# Canonical Project Model (Explanatory)

**Normative definition: `specs/SCHEMAS.md`.** This document explains intent and design rationale only. If it appears to contradict `SCHEMAS.md`, `SCHEMAS.md` wins and this document is a defect.

## Goals
Round-trip editable icon systems; variants and provenance are first-class; output formats are never the source of truth; the schema is migratable; persisted geometry is deterministic across JavaScript engines.

## Why a canonical model rather than SVG files
Variants, components, provenance, design rules, font mappings and export profiles exceed SVG's project semantics (ADR-001). SVG is an interchange format at the import and export edges.

## Design system
The grid, safe area, stroke policy, corner radius, default paint token, naming pattern and rule severities describe the *visual language of the set*. Changing them does not rewrite icons; `set.applyStyle` does that explicitly with a dry-run preview.

## Geometry
- Nodes are typed (`path`, `group`, `rect`, `ellipse`, `line`, `polyline`, `instance`). Arbitrary DOM is never admitted.
- Paths are stored as **structured absolute segments** (ADR-019): edits address segments directly, diffing is exact, quantization is unambiguous, and the compiler never reparses its own state. Arcs are converted to cubics at import with a diagnostic.
- All persisted coordinates are quantized to `0.001` viewBox units (ADR-018). This is ~1/24000 of a 24-unit icon — far below any visible or rasterizable difference — and is what makes CLI, Chromium, Firefox and WebKit produce identical artifacts.
- `fillRule` is explicit; `role` supports duotone layering.

## Variants
Variant dimensions are explicit (`style`, `size`, `state`, `x-*` custom), never encoded in names. A variant is the base icon plus an ordered list of **typed override operations**. This keeps the base editable and the variant diffable.

## Components
Reusable geometry with typed parameters. In V1 parameters bind only to stroke width, corner radius and visibility; richer constraints arrive with recipes.

## Provenance
Source, author, SPDX licence (or `UNKNOWN` — never guessed), attribution, original hash, import time and modification flag. Provenance drives `LICENSES.txt` / `ATTRIBUTIONS.md` generation and the export dialog's licence-impact summary.

## Serialization (`.iconproj`)
A ZIP container:

```text
manifest.json            # { format: "iconforge-project", formatVersion: 1, schemaVersion, projectId, contentSha256 }
project.json             # ProjectV1, canonical JSON (sorted keys, canonical numbers, LF)
originals/<sha256>.svg   # preserved original imports (ADR-011), optional
extensions/<namespace>/  # opaque extension payloads
```

Thumbnails and caches are never stored in the package; they are disposable.

## Migration
Every persisted document has `schemaVersion`. Migrations are pure ordered transforms with fixtures for every historical version. Future major versions open read-only.
