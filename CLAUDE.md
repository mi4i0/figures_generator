# figures_generator — CLAUDE.md

Web app: NATO APP-6D SIDC → multi-color `.3mf` badge for Bambu Studio (P1S).

## Commands

```bash
npm run dev      # dev server at http://localhost:5173
npm run build    # tsc --noEmit && vite build (always run before marking work done)
```

## Architecture

```
src/
  symbol.ts       — SIDC → SVG (milsymbol). normalizeSidc() strips hyphens/spaces.
  svgToParts.ts   — SVG fills → polygons; strokes → clipper-lib outlines; <text> → glyphs. Shape-agnostic.
  text.ts         — <text> amplifiers → filled glyph polys via bundled helvetiker_bold font.
  badgeBuilder.ts — Scales to mm, extrudes parts, adds negative-cylinder magnet recess.
  threeMf.ts      — Writes Bambu-compatible .3mf zip via fflate.
  viewer.ts       — three.js OrbitControls 3D preview.
  main.ts         — UI wiring, debounced regeneration.
  types.ts        — Shared interfaces (RawPart, PartMesh, BadgeSettings, BadgeModel).
  templates/      — project_settings.config cloned from a real Bambu P1S file;
                    only "filament_colour" is patched at runtime.
```

## Key invariants

- **SIDC input**: accepts both `10031500001407000000` and `10-0-3-15-0-0-00-111703-00-00`.
  Always call `normalizeSidc()` before passing to milsymbol or writing to a filename.
- **Shape-agnostic geometry**: never assume a circular frame. `svgToParts` works on whatever
  shape milsymbol emits (circle / rectangle / rhombus / square / quatrefoil).
- **Filament slots**: 1 = frame color, 2 = black, 3 = spare/extra. Slot 1 is the largest-area
  NON-BLACK fill color (auto-detected in `badgeBuilder.detectFrameColor`). Black fills are icon
  elements (cross, arrow…), never the frame. Stroke-only frames (e.g. medical white badges)
  have no fill → slot 1 falls back to white (`#ffffff`).
- **Text amplifiers**: milsymbol draws entity letters / designations as `<text>` (e.g. "MEP",
  "EPW"). `SVGLoader` ignores `<text>`, so `svgToParts` re-parses them (`parseTextElements`) and
  `text.ts` turns each into filled black glyph polygons via the bundled `helvetiker_bold` font,
  centered on the `x`/`y` anchor (matches milsymbol's middle/middle). Shrunk by `SIZE_SAFETY`
  (0.9), then clamped to `maxTextWidth` (frame width × 0.88, captured BEFORE text is added to
  the bbox) so wider labels (e.g. "TCP"/"EPW" at font-size 35) scale down uniformly to stay
  inside the frame instead of poking out the sides. They extrude as raised black (slot 2).
- **Base never includes fills**: `buildBaseOutline` skips ALL fill parts (frame fill is added
  explicitly; icon/text fills are raised features whose winding would punch holes in the base).
  When there's no frame fill it synthesizes the base from the outer contour of the largest
  closed stroke polygon (the frame ring).
- **Base plate**: `buildBaseOutline` (in `svgToParts.ts`) = frame fill + a SOLID rectangle behind
  each external amplifier group (echelon above / mobility/towed below the frame box, classified by
  each mark's center-Y), unioned and lightly closed (`baseBridge`). The solid rects give a
  continuous background under amplifier marks instead of a gappy trace, and keep the bottom edge
  solid so the peg can attach there.
- **Peg start**: the peg ("палочка") starts at the badge's bottom edge (centered) and overlaps a
  few mm up into the solid base to fuse — it must NOT run up to the badge center.
- **Mounting** (`settings.mount`): `'magnet'` = `negative_part` cylinder recess in the back
  (slicer subtracts it, no browser CSG; default ⌀8.2 × 2.2 mm); `'peg'` = a `normal_part` post
  ("палочка") at the bottom-center of the FULL footprint (below mobility/towed marks), in-plane
  and full base thickness so badge+peg print flat as one piece for standing in a base;
  `'none'` = neither. Magnet and peg are mutually exclusive.
- **Copies**: `buildThreeMf(model, name, count)` lays out `count` copies in a centered grid
  (`computeLayout`, spacing from the real mesh XY bbox + `COPY_GAP`) as repeated `<item>` /
  `<model_instance>` / `<assemble_item>` — meshes are defined once, so the file barely grows.
  Count affects only the downloaded file, not the 3D preview.
- **3MF structure**: `3D/3dmodel.model` (one assembly `<object>` whose `<components>` reference
  N per-part `<object>` meshes) + `Metadata/model_settings.config` (per-part extruder/subtype)
  + patched `project_settings.config`. All files must be well-formed XML.
- **Verification**: after any geometry change, run `npm run build` and test in the browser.
  Final check = open the `.3mf` in Bambu Studio (cannot be done headlessly).

## Reference files

Example badges reverse-engineered from:
`C:\Users\User\Downloads\140\Сині\` — especially `04 - РПГ - важкий.3mf`.
