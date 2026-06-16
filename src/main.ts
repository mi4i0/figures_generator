import './style.css';
import { sidcToSvg, setAffiliation, formatSidc, normalizeSidc } from './symbol';
import { svgToParts } from './svgToParts';
import { buildBadge } from './badgeBuilder';
import { buildThreeMf } from './threeMf';
import { Viewer } from './viewer';
import type { BadgeModel, BadgeSettings } from './types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const sidcInput = $<HTMLInputElement>('sidc');
const affiliationSel = $<HTMLSelectElement>('affiliation');
const sizeInput = $<HTMLInputElement>('size');
const baseInput = $<HTMLInputElement>('baseThickness');
const lineInput = $<HTMLInputElement>('lineHeight');
const magDiaInput = $<HTMLInputElement>('magnetDia');
const magDepthInput = $<HTMLInputElement>('magnetDepth');
const svgPreview = $<HTMLDivElement>('svgPreview');
const statusEl = $<HTMLParagraphElement>('status');
const downloadBtn = $<HTMLButtonElement>('download');

const viewer = new Viewer($('viewer'));

let currentModel: BadgeModel | null = null;
let currentName = 'badge';

function readSettings(): BadgeSettings {
  return {
    sizeMm: clamp(parseFloat(sizeInput.value), 5, 120, 25),
    baseThickness: clamp(parseFloat(baseInput.value), 0.4, 10, 2.4),
    lineHeight: clamp(parseFloat(lineInput.value), 0.1, 5, 0.6),
    magnetDia: clamp(parseFloat(magDiaInput.value), 0, 40, 8.2),
    magnetDepth: clamp(parseFloat(magDepthInput.value), 0, 8, 2.2),
  };
}

function clamp(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

function setStatus(msg: string, kind: '' | 'ok' | 'error' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`.trim();
}

function regenerate(): void {
  const sidc = normalizeSidc(sidcInput.value);
  if (!sidc) {
    setStatus('Введіть SIDC', 'error');
    return;
  }
  try {
    const { svg } = sidcToSvg(sidc);
    svgPreview.innerHTML = svg;

    const parts = svgToParts(svg);
    if (parts.parts.length === 0) {
      setStatus('Символ не містить геометрії', 'error');
      return;
    }

    const model = buildBadge(parts, readSettings());
    currentModel = model;
    currentName = sanitize(sidc);
    viewer.setModel(model);

    const colorCount = new Set(model.meshes.map((m) => m.extruder)).size;
    setStatus(`Готово: ${model.meshes.length} частин, ${colorCount} кольори`, 'ok');
    downloadBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus(`Помилка: ${(err as Error).message}`, 'error');
    downloadBtn.disabled = true;
  }
}

function sanitize(sidc: string): string {
  return `app6_${normalizeSidc(sidc)}`.slice(0, 40);
}

function download(): void {
  if (!currentModel) return;
  const blob = buildThreeMf(currentModel, currentName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentName}.3mf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let debounce = 0;
function scheduleRegenerate(): void {
  clearTimeout(debounce);
  debounce = window.setTimeout(regenerate, 120);
}

// The affiliation dropdown patches digit 4 of the SIDC for convenience,
// preserving the hyphen-grouped display form if the user is using it.
affiliationSel.addEventListener('change', () => {
  const patched = setAffiliation(sidcInput.value, affiliationSel.value);
  sidcInput.value = sidcInput.value.includes('-') ? formatSidc(patched) : patched;
  scheduleRegenerate();
});

for (const el of [sidcInput, sizeInput, baseInput, lineInput, magDiaInput, magDepthInput]) {
  el.addEventListener('input', scheduleRegenerate);
}
downloadBtn.addEventListener('click', download);

regenerate();
