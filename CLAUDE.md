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
  svgToParts.ts   — SVG fills → polygons; strokes → clipper-lib outlines. Shape-agnostic.
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
  fill color (auto-detected in `badgeBuilder.detectFrameColor`).
- **Magnet recess**: emitted as a Bambu `negative_part` cylinder — the slicer subtracts it,
  so no browser CSG. Default ⌀8.2 × 2.2 mm.
- **3MF structure**: `3D/3dmodel.model` (one assembly `<object>` whose `<components>` reference
  N per-part `<object>` meshes) + `Metadata/model_settings.config` (per-part extruder/subtype)
  + patched `project_settings.config`. All files must be well-formed XML.
- **Verification**: after any geometry change, run `npm run build` and test in the browser.
  Final check = open the `.3mf` in Bambu Studio (cannot be done headlessly).

## Reference files

Example badges reverse-engineered from:
`C:\Users\User\Downloads\140\Сині\` — especially `04 - РПГ - важкий.3mf`.
