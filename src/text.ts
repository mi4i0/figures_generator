import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import fontData from 'three/examples/fonts/helvetiker_bold.typeface.json';
import type { Poly, Pt } from './types';

// milsymbol draws text amplifiers (entity letters like "MEP", echelon dots, unit
// designations) as <text> elements. THREE.SVGLoader ignores <text>, so those marks
// never become geometry. We re-create them as filled glyph outlines using a bundled
// vector font (Arial-like helvetiker bold), so they extrude as raised black letters.

const font = new Font(fontData as unknown as ConstructorParameters<typeof Font>[0]);
const CURVE_DIVISIONS = 6;
// helvetiker bold runs a touch wider than milsymbol's Arial; shrink slightly so
// glyphs keep a margin from the frame instead of fusing into it.
const SIZE_SAFETY = 0.9;

/**
 * Convert a single SVG <text> run into filled glyph polygons, positioned so the
 * glyph bounding-box center lands at (x, y). This matches milsymbol's
 * text-anchor="middle" + dominant-baseline="middle" labels. Output is in SVG
 * coordinates (y grows downward), consistent with the rest of svgToParts.
 *
 * `maxWidth` (SVG units) clamps the rendered glyph width: helvetiker bold is wider
 * than milsymbol's Arial, so longer labels (e.g. "TCP", "EPW" at font-size 35) would
 * otherwise poke out the sides of the frame. When the natural width exceeds maxWidth
 * the whole run is scaled down uniformly (keeping the aspect ratio and center).
 */
export function textToPolys(
  text: string,
  x: number,
  y: number,
  size: number,
  maxWidth = Infinity,
): Poly[] {
  let shapes;
  try {
    shapes = font.generateShapes(text, size * SIZE_SAFETY);
  } catch {
    return [];
  }

  // Collect glyph outlines (font space: y grows upward) and their bounding box.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const raw = shapes.map((s) => {
    const { shape, holes } = s.extractPoints(CURVE_DIVISIONS);
    for (const p of shape) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { shape, holes };
  });
  if (minX === Infinity) return [];

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const naturalWidth = maxX - minX;
  const scale = naturalWidth > maxWidth && naturalWidth > 0 ? maxWidth / naturalWidth : 1;
  // Map glyph point -> SVG space: recenter on bbox, scale to fit, flip Y
  // (font up -> SVG down), then translate to the text anchor (x, y).
  const m = (p: { x: number; y: number }): Pt => ({
    x: (p.x - cx) * scale + x,
    y: -(p.y - cy) * scale + y,
  });

  return raw.map(({ shape, holes }) => ({
    outer: shape.map(m),
    holes: holes.map((h) => h.map(m)),
  }));
}
