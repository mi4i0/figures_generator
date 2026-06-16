import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import ClipperLib from 'clipper-lib';
import type { Poly, Pt, RawPart, SvgParts } from './types';

const CURVE_DIVISIONS = 48;
const CLIPPER_SCALE = 1000;

/** Normalize any CSS color string to lowercase "#rrggbb". */
function normalizeColor(input: string | undefined | null): string | null {
  if (!input || input === 'none' || input === 'transparent') return null;
  try {
    return '#' + new THREE.Color(input).getHexString();
  } catch {
    return null;
  }
}

function isClosed(points: Pt[]): boolean {
  if (points.length < 3) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;
}

/** Convert a THREE.Shape (and its holes) to our Poly representation. */
function shapeToPoly(shape: THREE.Shape): Poly {
  const { shape: outerPts, holes } = shape.extractPoints(CURVE_DIVISIONS);
  return {
    outer: outerPts.map((p) => ({ x: p.x, y: p.y })),
    holes: holes.map((h) => h.map((p) => ({ x: p.x, y: p.y }))),
  };
}

type ClipperPt = { X: number; Y: number };

// clipper-lib exposes Childs()/Contour()/IsHole() as methods on PolyNode.
const childsOf = (node: any): any[] => (typeof node.Childs === 'function' ? node.Childs() : node.m_Childs ?? []);
const contourOf = (node: any): ClipperPt[] => (typeof node.Contour === 'function' ? node.Contour() : node.m_polygon ?? []);
const toPt = (p: ClipperPt): Pt => ({ x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE });
const toClipperPath = (ring: Pt[]): ClipperPt[] =>
  ring.map((p) => ({ X: Math.round(p.x * CLIPPER_SCALE), Y: Math.round(p.y * CLIPPER_SCALE) }));

function walkPolyTree(node: any, out: Poly[]): void {
  // In a Clipper PolyTree, a node's direct children are the opposite type to it
  // (outer -> holes -> outer ...). Root children are outers.
  for (const child of childsOf(node)) {
    const outer: Pt[] = contourOf(child).map(toPt);
    const holes: Pt[][] = [];
    for (const holeNode of childsOf(child)) {
      holes.push(contourOf(holeNode).map(toPt));
      // A hole's children are new outer polygons (nested islands).
      walkPolyTree(holeNode, out);
    }
    out.push({ outer, holes });
  }
}

/**
 * Offset a polyline by half the stroke width to produce closed outline polygons
 * (a filled representation of the stroke that can be extruded).
 */
function strokeToPolys(points: Pt[], strokeWidth: number, closed: boolean): Poly[] {
  if (points.length < 2 || strokeWidth <= 0) return [];
  const co = new ClipperLib.ClipperOffset(2, 0.25 * CLIPPER_SCALE);
  const path: ClipperPt[] = points.map((p) => ({
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE),
  }));
  const endType = closed
    ? ClipperLib.EndType.etClosedLine
    : ClipperLib.EndType.etOpenRound;
  co.AddPath(path, ClipperLib.JoinType.jtRound, endType);

  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, (strokeWidth / 2) * CLIPPER_SCALE);

  const polys: Poly[] = [];
  walkPolyTree(tree, polys);
  return polys;
}

/** Offset a set of closed polygons (with holes) by a scaled delta. */
function offsetClosed(polys: Poly[], deltaScaled: number): Poly[] {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * CLIPPER_SCALE);
  for (const poly of polys) {
    co.AddPath(toClipperPath(poly.outer), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    for (const hole of poly.holes) {
      co.AddPath(toClipperPath(hole), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    }
  }
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, deltaScaled);
  const out: Poly[] = [];
  walkPolyTree(tree, out);
  return out;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxOf(polys: Poly[]): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly.outer) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

const mergeBox = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

const rectPoly = (b: Box): Poly => ({
  outer: [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ],
  holes: [],
});

/**
 * Build a single printable base outline.
 *
 * The frame fill forms the base. Amplifier marks that milsymbol draws OUTSIDE
 * the frame (echelon above, mobility / towed array below) are backed by a SOLID
 * rectangle spanning their extent and joined to the frame — so the background
 * there is continuous, not a gappy trace of the thin marks. Marks inside/around
 * the frame are unioned as-is. An optional morphological closing (`bridgeUnits`)
 * tidies any remaining slivers. (SVG y grows downward: smaller y = above.)
 */
export function buildBaseOutline(
  parts: RawPart[],
  bridgeUnits: number,
  frameColor: string,
): Poly[] {
  const framePolys: Poly[] = [];
  for (const part of parts) {
    if (part.role === 'fill' && part.color === frameColor) framePolys.push(...part.polys);
  }
  const frameBox = boxOf(framePolys);

  const basePolys: Poly[] = [...framePolys];
  let above: Box | null = null;
  let below: Box | null = null;

  if (frameBox) {
    const frameH = frameBox.maxY - frameBox.minY;
    const pad = frameH * 0.04; // side margin around the marks
    const connect = frameH * 0.06; // overlap back into the frame

    for (const part of parts) {
      if (part.role === 'fill' && part.color === frameColor) continue;
      for (const poly of part.polys) {
        const b = boxOf([poly]);
        if (!b) continue;
        const cy = (b.minY + b.maxY) / 2;
        if (cy < frameBox.minY) above = above ? mergeBox(above, b) : b; // echelon
        else if (cy > frameBox.maxY) below = below ? mergeBox(below, b) : b; // mobility/towed
        else basePolys.push(poly); // inside the frame: keep as-is (e.g. frame ring)
      }
    }
    if (above) {
      basePolys.push(rectPoly({
        minX: above.minX - pad, maxX: above.maxX + pad,
        minY: above.minY - pad, maxY: frameBox.minY + connect,
      }));
    }
    if (below) {
      basePolys.push(rectPoly({
        minX: below.minX - pad, maxX: below.maxX + pad,
        minY: frameBox.maxY - connect, maxY: below.maxY + pad,
      }));
    }
  } else {
    // No detectable frame: fall back to unioning every polygon.
    for (const part of parts) basePolys.push(...part.polys);
  }

  const clipper = new ClipperLib.Clipper();
  for (const poly of basePolys) {
    clipper.AddPath(toClipperPath(poly.outer), ClipperLib.PolyType.ptSubject, true);
    for (const hole of poly.holes) {
      clipper.AddPath(toClipperPath(hole), ClipperLib.PolyType.ptSubject, true);
    }
  }
  const unionTree = new ClipperLib.PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    unionTree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  let polys: Poly[] = [];
  walkPolyTree(unionTree, polys);

  if (bridgeUnits > 0) {
    const d = bridgeUnits * CLIPPER_SCALE;
    polys = offsetClosed(polys, d); // dilate: merge nearby pieces
    polys = offsetClosed(polys, -d); // erode: restore outer silhouette
  }
  return polys;
}

function pushPart(map: Map<string, RawPart>, color: string, role: 'fill' | 'stroke', polys: Poly[]): void {
  if (polys.length === 0) return;
  const key = `${role}:${color}`;
  let part = map.get(key);
  if (!part) {
    part = { color, role, polys: [] };
    map.set(key, part);
  }
  part.polys.push(...polys);
}

function updateBbox(bbox: SvgParts['bbox'], polys: Poly[]): void {
  for (const poly of polys) {
    for (const ring of [poly.outer, ...poly.holes]) {
      for (const p of ring) {
        if (p.x < bbox.minX) bbox.minX = p.x;
        if (p.y < bbox.minY) bbox.minY = p.y;
        if (p.x > bbox.maxX) bbox.maxX = p.x;
        if (p.y > bbox.maxY) bbox.maxY = p.y;
      }
    }
  }
}

/**
 * Parse a milsymbol SVG string into colored 2D parts. Fills become filled
 * polygons; strokes are offset into closed outline polygons. No assumption is
 * made about the frame shape (circle / rectangle / rhombus / quatrefoil).
 */
export function svgToParts(svgString: string): SvgParts {
  const loader = new SVGLoader();
  const data = loader.parse(svgString);

  const map = new Map<string, RawPart>();
  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  for (const path of data.paths) {
    const style = path.userData?.style ?? {};
    const fillColor = normalizeColor(style.fill);
    const strokeColor = normalizeColor(style.stroke);

    // Fills -> extrudable shapes (frame plate, filled icon regions).
    if (fillColor) {
      const shapes = SVGLoader.createShapes(path);
      const polys = shapes.map(shapeToPoly);
      pushPart(map, fillColor, 'fill', polys);
      updateBbox(bbox, polys);
    }

    // Strokes -> outline polygons (frame ring, icon lines).
    if (strokeColor) {
      const strokeWidth = style.strokeWidth ?? 1;
      const all: Poly[] = [];
      for (const subPath of path.subPaths) {
        const pts = subPath
          .getPoints(CURVE_DIVISIONS)
          .map((p: THREE.Vector2) => ({ x: p.x, y: p.y }));
        if (pts.length < 2) continue;
        all.push(...strokeToPolys(pts, strokeWidth, isClosed(pts)));
      }
      pushPart(map, strokeColor, 'stroke', all);
      updateBbox(bbox, all);
    }
  }

  return { parts: [...map.values()], bbox };
}
