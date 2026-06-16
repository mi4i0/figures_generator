import { strToU8, zipSync } from 'fflate';
import projectSettingsTemplate from './templates/project_settings.config?raw';
import type { BadgeModel, PartMesh } from './types';

const IDENTITY = '1 0 0 0 1 0 0 0 1 0 0 0';
// Bambu Lab P1S bed is 256x256 mm; place the object at the center.
const BED_CENTER = { x: 128, y: 128 };

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  // Compact but precise enough for printing.
  return Number(n.toFixed(5)).toString();
}

function meshXml(mesh: PartMesh): string {
  const v = mesh.vertices;
  const t = mesh.triangles;
  const verts: string[] = [];
  for (let i = 0; i < v.length; i += 3) {
    verts.push(`     <vertex x="${fmt(v[i])}" y="${fmt(v[i + 1])}" z="${fmt(v[i + 2])}"/>`);
  }
  const tris: string[] = [];
  for (let i = 0; i < t.length; i += 3) {
    tris.push(`     <triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
  }
  return `   <mesh>\n    <vertices>\n${verts.join('\n')}\n    </vertices>\n    <triangles>\n${tris.join('\n')}\n    </triangles>\n   </mesh>`;
}

/** Spacing between adjacent copies on the plate, mm. */
const COPY_GAP = 6;

/**
 * Lay out `count` copies of the model in a centered grid on the plate, spaced by
 * the model's actual XY footprint so they never overlap. Returns the (tx, ty)
 * for each copy's build item (the model is centered on its own origin).
 */
function computeLayout(model: BadgeModel, count: number): { tx: number; ty: number }[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const mesh of model.meshes) {
    const v = mesh.vertices;
    for (let i = 0; i < v.length; i += 3) {
      if (v[i] < minX) minX = v[i];
      if (v[i] > maxX) maxX = v[i];
      if (v[i + 1] < minY) minY = v[i + 1];
      if (v[i + 1] > maxY) maxY = v[i + 1];
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cellW = maxX - minX + COPY_GAP;
  const cellH = maxY - minY + COPY_GAP;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const gridW = cols * cellW;
  const gridH = rows * cellH;

  const out: { tx: number; ty: number }[] = [];
  for (let k = 0; k < count; k++) {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const cellCx = BED_CENTER.x + (col + 0.5) * cellW - gridW / 2;
    const cellCy = BED_CENTER.y + (row + 0.5) * cellH - gridH / 2;
    out.push({ tx: cellCx - cx, ty: cellCy - cy });
  }
  return out;
}

function modelXml(model: BadgeModel, name: string, layout: { tx: number; ty: number }[]): string {
  const meshes = model.meshes;
  const N = meshes.length;

  // Mesh objects — defined once, shared by all assembly copies via <component>.
  const objects = meshes
    .map((mesh, i) => `  <object id="${i + 1}" type="model">\n${meshXml(mesh)}\n  </object>`)
    .join('\n');

  const components = meshes
    .map((_, i) => `    <component objectid="${i + 1}" transform="${IDENTITY}"/>`)
    .join('\n');

  // Each copy gets its own assembly object so Bambu Studio assigns filament colors
  // independently per copy (shared single-assembly approach only colors copy 0).
  const assemblies = layout
    .map((_, k) => {
      const asmId = N + 1 + k;
      return `  <object id="${asmId}" type="model">
   <components>
${components}
   </components>
  </object>`;
    })
    .join('\n');

  const items = layout
    .map(
      (p, k) =>
        `  <item objectid="${N + 1 + k}" transform="1 0 0 0 1 0 0 0 1 ${fmt(p.tx)} ${fmt(p.ty)} 0" printable="1"/>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">figures-generator</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${esc(name)}</metadata>
 <resources>
${objects}
${assemblies}
 </resources>
 <build>
${items}
 </build>
</model>`;
}

function modelSettingsXml(model: BadgeModel, name: string, count: number): string {
  const N = model.meshes.length;
  const parts = model.meshes
    .map(
      (mesh, i) => `    <part id="${i + 1}" subtype="${mesh.subtype}">
      <metadata key="name" value="${esc(mesh.name)}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="${mesh.extruder}"/>
    </part>`,
    )
    .join('\n');

  // Each copy has its own assembly object → its own extruder config block.
  const objects = Array.from(
    { length: count },
    (_, k) => `  <object id="${N + 1 + k}">
    <metadata key="name" value="${esc(name)}"/>
    <metadata key="extruder" value="1"/>
${parts}
  </object>`,
  ).join('\n');

  const instances = Array.from(
    { length: count },
    (_, k) => `    <model_instance>
      <metadata key="object_id" value="${N + 1 + k}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>`,
  ).join('\n');

  const assembleItems = Array.from(
    { length: count },
    (_, k) =>
      `   <assemble_item object_id="${N + 1 + k}" instance_id="0" transform="${IDENTITY}" offset="0 0 0" />`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objects}
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
${instances}
  </plate>
  <assemble>
${assembleItems}
  </assemble>
</config>`;
}

function projectSettingsXml(colors: string[]): string {
  const arr = colors.map((c) => `        "${c.toUpperCase()}"`).join(',\n');
  const block = `"filament_colour": [\n${arr}\n    ]`;
  return projectSettingsTemplate.replace(/"filament_colour":\s*\[[^\]]*\]/, block);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const SLICE_INFO = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.07.01.57"/>
  </header>
</config>`;

/** Assemble a Bambu Studio-compatible .3mf as a Blob, with `count` copies. */
export function buildThreeMf(model: BadgeModel, name: string, count = 1): Blob {
  const n = Math.max(1, Math.floor(count));
  const layout = computeLayout(model, n);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(modelXml(model, name, layout)),
    'Metadata/model_settings.config': strToU8(modelSettingsXml(model, name, n)),
    'Metadata/project_settings.config': strToU8(projectSettingsXml(model.filamentColors)),
    'Metadata/slice_info.config': strToU8(SLICE_INFO),
  };
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'model/3mf' });
}
