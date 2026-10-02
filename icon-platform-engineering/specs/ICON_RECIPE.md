# Icon Recipe Specification

Status: Phase 9 (post-V1). `IconV1.recipeRef` is reserved in V1; no evaluator ships in V1.

## Purpose
A structured, editable and AI-friendly representation for icons that can be expressed semantically/parametrically. Recipes complement raw path geometry; they do not need to represent every possible SVG.

## Example
```yaml
version: 1
canvas: { width: 24, height: 24 }
style: outline
parameters:
  stroke: 1.75
  radius: 2
nodes:
  - type: document
    id: body
    x: 4
    y: 2
    width: 16
    height: 20
    radius: $radius
  - type: medicalCross
    id: cross
    cx: 12
    cy: 13
    size: 6
paint:
  stroke: currentColor
  strokeWidth: $stroke
  lineCap: round
  lineJoin: round
```

## Requirements
- Versioned schema.
- Deterministic evaluation.
- Typed primitives and parameters.
- References to reusable components.
- Constraints/anchors for relative placement.
- No arbitrary executable JavaScript.
- Bounded expression language if expressions are introduced.
- Evaluation produces canonical, **quantized** geometry (ADR-018) plus source mapping back to recipe nodes.
- Evaluation is a pure function run inside a command handler; its output, not the recipe, is what the compiler consumes.

## AI contract
AI outputs recipe JSON/YAML or a typed command plan conforming to schema. Invalid proposals are rejected before preview. Existing recipe modifications should target parameters/nodes rather than regenerate unrelated geometry.

## Escape hatch
Icons not representable as recipes remain fully supported as canonical geometry. Converting arbitrary geometry to a recipe is optional and must never be falsely claimed as lossless.
