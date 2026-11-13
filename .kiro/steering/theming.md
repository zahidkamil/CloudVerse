# CloudVerse: Theming Principles

A theme is **data**, validated against the ThemeSpec schema (`packages/theme`). All
themes (City, Haunted Cloud, Jungle, Metro, Floating World, composed or generated
custom themes) go through the same procedural renderer. A theme never adds engine code.

## Role-based mapping, not per-resource mapping

- Resources map to a small provider-neutral **role** taxonomy (compute, object-storage,
  database, identity, network-container, subnet, traffic-filter, gateway, connectivity,
  unknown). The taxonomy lives in `core` and providers.
- A theme maps **roles** to recipes. An unsupported resource type still gets a sensible
  object through its role (or the `unknown` role). Nobody maps individual resources by hand.

## What a ThemeSpec may contain

Palette, role-to-recipe references with overrides, group styling (districts, platforms),
layout hint (from the engine's fixed set), ambience (fog, lights, sky), capped decor
scatter, and a choice among engine-owned overlay styles.

## What a ThemeSpec must never contain

- Nodes, edges, permissions, findings, scores, or any infrastructure fact.
- Executable code, external URLs, or textures/models fetched at runtime.
- Anything that disables or hides severity, diff, or attack-path overlays.

## Rules

1. Geometry comes from the declarative recipe DSL with hard caps (primitive count,
   instance count, size). The renderer interprets recipes; it never executes theme code.
2. Every theme must cover every role. Missing roles are filled from a base theme.
3. Readability budget: contrast clamps on palettes, minimum emissive on nodes, one
   distinct recipe per role, decor kept clear of node bounds and never pickable.
4. Applying a theme must not change the graph. Tests assert the graph hash is identical
   before and after every theme switch.
5. Reuse before generating: search the recipe library, mix, recolor, and only create new
   recipes when nothing fits. Validate, cache, and fall back to a predefined theme.
6. The optional runtime LLM (Tier 3) only chooses among theme options. It never sees
   resource names or plan content and never touches the graph.
