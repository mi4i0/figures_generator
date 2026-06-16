// Shared types for the badge-generation pipeline.

/** A point in SVG user-space coordinates. */
export interface Pt {
  x: number;
  y: number;
}

/** A closed polygon with optional holes (all in SVG coordinates). */
export interface Poly {
  outer: Pt[];
  holes: Pt[][];
}

/** Whether a part originated from an SVG fill or an SVG stroke. */
export type PartRole = 'fill' | 'stroke';

/** One color region of the symbol, as 2D closed polygons. */
export interface RawPart {
  /** Normalized hex color, e.g. "#0061c1". */
  color: string;
  role: PartRole;
  polys: Poly[];
}

export interface SvgParts {
  parts: RawPart[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

/** How the badge is mounted/displayed. */
export type MountType = 'magnet' | 'peg' | 'none';

/** User-configurable physical parameters of the badge (millimeters). */
export interface BadgeSettings {
  /** Longest footprint dimension. */
  sizeMm: number;
  baseThickness: number;
  lineHeight: number;
  /** Mounting style: magnet recess, stand peg, or none. */
  mount: MountType;
  magnetDia: number;
  magnetDepth: number;
  /** Stand peg ("палочка"): width (X), protrusion length (Y), height/thickness (Z). */
  pegWidth: number;
  pegLength: number;
  pegHeight: number;
  /**
   * Morphological-closing distance (mm) used to connect detached amplifier
   * marks (echelon, mobility, HQ/TF/dummy) to the frame so they share one base.
   */
  baseBridge: number;
}

export const DEFAULT_SETTINGS: BadgeSettings = {
  sizeMm: 25,
  baseThickness: 2.4,
  lineHeight: 0.6,
  mount: 'none',
  magnetDia: 8.15,
  magnetDepth: 2,
  pegWidth: 2.5,
  pegLength: 30,
  pegHeight: 2.5,
  baseBridge: 1.2,
};

/** An indexed triangle mesh in final millimeter coordinates. */
export interface PartMesh {
  name: string;
  /** Flat [x0,y0,z0, x1,y1,z1, ...] in mm. */
  vertices: Float32Array;
  /** Flat [a0,b0,c0, ...] triangle vertex indices. */
  triangles: Uint32Array;
  /** 1-based filament/extruder slot. */
  extruder: number;
  /** Bambu part subtype. */
  subtype: 'normal_part' | 'negative_part';
}

export interface BadgeModel {
  meshes: PartMesh[];
  /** Filament colors per slot (hex), index 0 == slot 1. */
  filamentColors: string[];
  /** Footprint bounding box in mm (centered at origin). */
  sizeMm: number;
}
