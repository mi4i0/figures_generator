# figures_generator — APP-6D → 3MF

Web app that turns a **NATO APP-6D SIDC** (Symbol Identification Code) into a print-ready,
multi-color **`.3mf`** badge for **Bambu Studio** (Bambu Lab P1S).

Enter a SIDC → see the 2D symbol and a live 3D relief → download a `.3mf` with each color as a
separate part (correct filament/extruder assignment) and a magnet recess cut into the back.

## How it works

```
SIDC ──milsymbol──▶ SVG ──SVGLoader + clipper──▶ 2D color parts
     ──extrude (three.js)──▶ stacked relief meshes ──fflate──▶ .3mf (Bambu)
```

- **`src/symbol.ts`** — milsymbol renders the SIDC to SVG, with solid filament colors per
  affiliation (Friend `#0061C1`, Hostile `#FF0000`, Neutral `#00A651`, Unknown `#F7C600`) and no
  white icon halo.
- **`src/svgToParts.ts`** — parses the SVG (`three` `SVGLoader`). Fills become filled polygons;
  strokes are offset into closed outline polygons with `clipper-lib`. Shape-agnostic: works for
  circle / rectangle / rhombus / square / quatrefoil frames.
- **`src/badgeBuilder.ts`** — scales the footprint to the chosen size (mm), extrudes the frame
  fill as the **base plate**, raises all other colors (lines, icon) on the front, and adds a
  **negative cylinder** for the magnet recess. Outputs indexed meshes.
- **`src/threeMf.ts`** — writes a Bambu-compatible `.3mf` zip: `3dmodel.model` (one assembly
  object referencing per-part meshes), `model_settings.config` (per-part name/extruder/subtype),
  and `project_settings.config` (cloned from `src/templates/`, with `filament_colour` patched).
- **`src/viewer.ts`** — three.js preview rendered from the exact meshes that get exported.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
```

## Printing notes

- Default badge: 25 mm, base 2.4 mm, raised lines +0.6 mm, magnet recess ⌀8.2 × 2.2 mm
  (all editable in the UI).
- Colors map to AMS slots: **1 = frame color, 2 = black, 3 = spare/extra**.
- The magnet recess opens on the back (bed side); flip/orient in the slicer as preferred.
- Open the downloaded `.3mf` in Bambu Studio to slice. The example reference files this was
  modeled on live in `Downloads/140/Сині/`.

## Roadmap

- Batch generation (many SIDCs → zip of `.3mf`), per-element filament override UI,
  configurable magnet presets, embedded plate thumbnail.
