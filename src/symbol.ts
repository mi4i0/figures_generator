import ms from 'milsymbol';

/**
 * Filament-exact affiliation fill colors. milsymbol normally fills frames with
 * pastel affiliation colors; we override them so the generated SVG already uses
 * the colors we want to print, making color->filament mapping trivial.
 */
export const AFFILIATION_FILL: Record<string, string> = {
  Friend: '#0061C1',
  Hostile: '#FF0000',
  Neutral: '#00A651',
  Unknown: '#F7C600',
  // milsymbol also references these keys for dashed/assumed variants:
  Civilian: '#A000A0',
};

export interface SymbolResult {
  svg: string;
  /** milsymbol-resolved metadata (affiliation, etc.). */
  affiliation: string;
}

/**
 * Strip a SIDC down to its bare digits, accepting both the continuous form
 * ("10031500001117030000") and the hyphen/space-grouped form
 * ("10-0-3-15-0-0-00-111703-00-00").
 */
export function normalizeSidc(input: string): string {
  return input.replace(/\D/g, '');
}

// APP-6D 20-digit field lengths: version, context, identity, symbol set,
// status, HQ/TF/dummy, amplifier, entity, modifier 1, modifier 2.
const SIDC_GROUPS = [2, 1, 1, 2, 1, 1, 2, 6, 2, 2];

/** Format bare SIDC digits into the hyphen-grouped APP-6D display form. */
export function formatSidc(input: string): string {
  const d = normalizeSidc(input);
  const groups: string[] = [];
  let i = 0;
  for (const g of SIDC_GROUPS) {
    if (i >= d.length) break;
    groups.push(d.slice(i, i + g));
    i += g;
  }
  if (i < d.length) groups.push(d.slice(i)); // keep any trailing extra digits
  return groups.join('-');
}

/**
 * Render a SIDC to an SVG string using milsymbol, with solid filament colors
 * and no white icon halo (so we don't introduce stray colors). Accepts grouped
 * or continuous SIDC input.
 */
export function sidcToSvg(sidc: string, size = 100): SymbolResult {
  const symbol = new ms.Symbol(normalizeSidc(sidc), {
    size,
    fill: true,
    frame: true,
    outlineWidth: 0,
    colorMode: AFFILIATION_FILL,
  });

  const svg = symbol.asSVG();
  const metadata = symbol.getMetadata?.() ?? {};
  return { svg, affiliation: metadata.affiliation ?? '' };
}

/**
 * Patch the standard-identity (affiliation) digit of a 20-digit APP-6D SIDC.
 * Digit index 3 (0-based): 1=Unknown, 3=Friend, 4=Neutral, 6=Hostile.
 */
export function setAffiliation(sidc: string, digit: string): string {
  const d = normalizeSidc(sidc);
  if (d.length < 4) return sidc;
  return d.slice(0, 3) + digit + d.slice(4);
}
