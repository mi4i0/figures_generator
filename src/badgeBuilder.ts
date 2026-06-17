import * as THREE from 'three';
import {
  mergeGeometries,
  mergeVertices,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildBaseOutline } from './svgToParts';
import type { BadgeModel, BadgeSettings, PartMesh, Poly, RawPart, SvgParts } from './types';

const BLACK = '#000000';

function polyArea(poly: Poly): number {
  const ring = (pts: { x: number; y: number }[]) => {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  };
  return ring(poly.outer) - poly.holes.reduce((s, h) => s + ring(h), 0);
}

/** Pick the fill color covering the largest area — that's the frame/base.
 *  Black fills are icon elements (cross, arrow, etc.), not the frame, so we skip them.
 *  If no non-black fill exists the frame is stroke-only (e.g. medical white frame);
 *  return white so the base plate gets a white filament slot. */
function detectFrameColor(parts: RawPart[]): string {
  let best = '';
  let bestArea = -1;
  for (const part of parts) {
    if (part.role !== 'fill') continue;
    if (part.color === BLACK) continue;
    const area = part.polys.reduce((s, p) => s + polyArea(p), 0);
    if (area > bestArea) {
      bestArea = area;
      best = part.color;
    }
  }
  return best || '#ffffff';
}

/** Build a THREE.Shape from a Poly using the SVG->mm transform. */
function polyToShape(poly: Poly, map: (x: number, y: number) => [number, number]): THREE.Shape {
  const shape = new THREE.Shape();
  poly.outer.forEach((p, i) => {
    const [x, y] = map(p.x, p.y);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  for (const hole of poly.holes) {
    const path = new THREE.Path();
    hole.forEach((p, i) => {
      const [x, y] = map(p.x, p.y);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    shape.holes.push(path);
  }
  return shape;
}

/** Extrude many polys into a single indexed mesh at a given z. */
function buildMesh(
  name: string,
  polys: Poly[],
  map: (x: number, y: number) => [number, number],
  zBottom: number,
  depth: number,
  extruder: number,
  subtype: PartMesh['subtype'] = 'normal_part',
): PartMesh | null {
  const geoms: THREE.BufferGeometry[] = [];
  for (const poly of polys) {
    if (poly.outer.length < 3) continue;
    const shape = polyToShape(poly, map);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      steps: 1,
    });
    geo.translate(0, 0, zBottom);
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    geoms.push(geo);
  }
  if (geoms.length === 0) return null;
  return toPartMesh(name, mergeGeometries(geoms, false), extruder, subtype);
}

function toPartMesh(
  name: string,
  raw: THREE.BufferGeometry,
  extruder: number,
  subtype: PartMesh['subtype'],
): PartMesh {
  // Use a tight epsilon so only truly duplicate vertices within one extrusion
  // are merged. The default (1e-4) is large enough to accidentally join boundary
  // vertices of adjacent shapes (e.g. letter outlines) → T-junctions → non-manifold.
  const indexed = mergeVertices(raw, 1e-6);
  const pos = indexed.getAttribute('position').array as Float32Array;
  const idx = indexed.getIndex();
  const triangles = idx
    ? Uint32Array.from(idx.array as ArrayLike<number>)
    : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  return {
    name,
    vertices: Float32Array.from(pos),
    triangles,
    extruder,
    subtype,
  };
}

/**
 * Convert parsed SVG parts into a printable multi-part badge:
 *  - the frame fill becomes the base plate,
 *  - all other colors (strokes + non-frame fills) are raised on the front,
 *  - a negative cylinder forms the magnet recess in the back.
 *
 * `hugAmplifiers` (Land equipment) makes the base trace each external amplifier
 * mark's outline instead of backing it with a solid rectangle.
 */
export function buildBadge(
  svg: SvgParts,
  settings: BadgeSettings,
  hugAmplifiers = false,
): BadgeModel {
  const { parts, bbox } = svg;
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  const maxDim = Math.max(width, height) || 1;
  // Round frames scale uniformly (diameter == widthMm) so they stay circular;
  // other shapes scale per-axis so width and height are honored independently.
  let sx: number;
  let sy: number;
  if (svg.isRound) {
    sx = sy = settings.widthMm / maxDim;
  } else {
    sx = settings.widthMm / (width || 1);
    sy = settings.heightMm / (height || 1);
  }
  const s = (sx + sy) / 2; // average scale, for converting the mm-based base bridge
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const map = (x: number, y: number): [number, number] => [(x - cx) * sx, -(y - cy) * sy];

  const frameColor = detectFrameColor(parts);

  // Filament slots: 1 = frame color, 2 = black, 3 = spare/extra color.
  const filamentColors = [frameColor, BLACK, '#FF0000'];
  const slotOf = (color: string): number => {
    if (color === BLACK) return 2;
    if (color === frameColor) return 1;
    filamentColors[2] = color; // record the extra color in slot 3
    return 3;
  };

  const meshes: PartMesh[] = [];

  // Base plate: union of ALL geometry, closed so detached amplifier marks
  // (echelon, mobility/towed array, HQ/task force/dummy) get a connected base
  // instead of floating above the build plate. Closing distance is in SVG units.
  const bridgeUnits = settings.baseBridge > 0 ? settings.baseBridge / s : 0;
  const basePolys = buildBaseOutline(parts, bridgeUnits, frameColor, !hugAmplifiers);
  const base = buildMesh('base', basePolys, map, 0, settings.baseThickness, 1);
  if (base) meshes.push(base);

  // Raised features: strokes (any color) + fills that aren't the frame color.
  const raised = new Map<string, Poly[]>();
  for (const part of parts) {
    const isBase = part.role === 'fill' && part.color === frameColor;
    if (isBase) continue;
    const list = raised.get(part.color) ?? [];
    list.push(...part.polys);
    raised.set(part.color, list);
  }
  let n = 0;
  for (const [color, polys] of raised) {
    const mesh = buildMesh(
      `lines_${++n}`,
      polys,
      map,
      settings.baseThickness,
      settings.lineHeight,
      slotOf(color),
    );
    if (mesh) meshes.push(mesh);
  }

  // Mounting feature.
  if (settings.mount === 'magnet' && settings.magnetDia > 0 && settings.magnetDepth > 0) {
    // Recess (negative part) cut into the back, centered on the footprint.
    const cyl = new THREE.CylinderGeometry(
      settings.magnetDia / 2,
      settings.magnetDia / 2,
      settings.magnetDepth,
      48,
    );
    cyl.rotateX(Math.PI / 2); // align axis to Z
    cyl.translate(0, 0, settings.magnetDepth / 2);
    cyl.deleteAttribute('uv');
    cyl.deleteAttribute('normal');
    meshes.push(toPartMesh('magnet', cyl, 1, 'negative_part'));
  } else if (
    settings.mount === 'peg' &&
    settings.pegWidth > 0 &&
    settings.pegLength > 0 &&
    settings.pegHeight > 0
  ) {
    // Stand peg ("палочка"): a rod that STARTS at the bottom edge of the badge
    // (centered) and protrudes below it, to plug into a separately-printed base.
    // The amplifier background is solid (see buildBaseOutline), so the bottom is
    // continuous material; the peg just overlaps a few mm up into it to fuse.
    // Z is its own height, resting on the build plate (z=0) so badge + peg print
    // flat as one solid piece.
    const overlap = Math.min(2.5, settings.baseThickness); // mm up into the base
    const bottomEdge = map(cx, bbox.maxY)[1]; // bottom of the footprint, in mm (negative)
    const pegTop = bottomEdge + overlap; // start at the badge bottom, slightly inside
    const pegBottom = bottomEdge - settings.pegLength; // tip protrudes pegLength below
    const lengthY = pegTop - pegBottom;
    const peg = new THREE.BoxGeometry(settings.pegWidth, lengthY, settings.pegHeight);
    peg.translate(0, (pegTop + pegBottom) / 2, settings.pegHeight / 2);
    peg.deleteAttribute('uv');
    peg.deleteAttribute('normal');
    meshes.push(toPartMesh('peg', peg, 1, 'normal_part'));
  }

  return { meshes, filamentColors, sizeMm: Math.max(settings.widthMm, settings.heightMm) };
}
