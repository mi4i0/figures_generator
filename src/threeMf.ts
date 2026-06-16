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

function modelXml(model: BadgeModel, name: string): string {
  const meshes = model.meshes;
  const asmId = meshes.length + 1;

  const objects = meshes
    .map(
      (mesh, i) =>
        `  <object id="${i + 1}" type="model">\n${meshXml(mesh)}\n  </object>`,
    )
    .join('\n');

  const components = meshes
    .map((_, i) => `    <component objectid="${i + 1}" transform="${IDENTITY}"/>`)
    .join('\n');

  const itemTransform = `1 0 0 0 1 0 0 0 1 ${BED_CENTER.x} ${BED_CENTER.y} 0`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">figures-generator</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${esc(name)}</metadata>
 <resources>
${objects}
  <object id="${asmId}" type="model">
   <components>
${components}
   </components>
  </object>
 </resources>
 <build>
  <item objectid="${asmId}" transform="${itemTransform}" printable="1"/>
 </build>
</model>`;
}

function modelSettingsXml(model: BadgeModel, name: string): string {
  const asmId = model.meshes.length + 1;
  const parts = model.meshes
    .map(
      (mesh, i) => `    <part id="${i + 1}" subtype="${mesh.subtype}">
      <metadata key="name" value="${esc(mesh.name)}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="${mesh.extruder}"/>
    </part>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${asmId}">
    <metadata key="name" value="${esc(name)}"/>
    <metadata key="extruder" value="1"/>
${parts}
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${asmId}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>
  <assemble>
   <assemble_item object_id="${asmId}" instance_id="0" transform="${IDENTITY}" offset="0 0 0" />
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

/** Assemble a Bambu Studio-compatible .3mf as a Blob. */
export function buildThreeMf(model: BadgeModel, name: string): Blob {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(modelXml(model, name)),
    'Metadata/model_settings.config': strToU8(modelSettingsXml(model, name)),
    'Metadata/project_settings.config': strToU8(projectSettingsXml(model.filamentColors)),
    'Metadata/slice_info.config': strToU8(SLICE_INFO),
  };
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'model/3mf' });
}
