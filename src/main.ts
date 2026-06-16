import './style.css';
import { sidcToSvg, normalizeSidc } from './symbol';
import { svgToParts } from './svgToParts';
import { buildBadge } from './badgeBuilder';
import { buildThreeMf } from './threeMf';
import { Viewer } from './viewer';
import type { BadgeModel, BadgeSettings, MountType } from './types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const sidcInput = $<HTMLInputElement>('sidc');
const sizeInput = $<HTMLInputElement>('size');
const countInput = $<HTMLInputElement>('count');
const baseInput = $<HTMLInputElement>('baseThickness');
const lineInput = $<HTMLInputElement>('lineHeight');
const mountSel = $<HTMLSelectElement>('mount');
const magDiaInput = $<HTMLInputElement>('magnetDia');
const magDepthInput = $<HTMLInputElement>('magnetDepth');
const pegWidthInput = $<HTMLInputElement>('pegWidth');
const pegLengthInput = $<HTMLInputElement>('pegLength');
const pegHeightInput = $<HTMLInputElement>('pegHeight');
const baseBridgeInput = $<HTMLInputElement>('baseBridge');
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
    mount: mountSel.value as MountType,
    magnetDia: clamp(parseFloat(magDiaInput.value), 0, 40, 8.15),
    magnetDepth: clamp(parseFloat(magDepthInput.value), 0, 8, 2),
    pegWidth: clamp(parseFloat(pegWidthInput.value), 0.5, 20, 2.5),
    pegLength: clamp(parseFloat(pegLengthInput.value), 1, 80, 30),
    pegHeight: clamp(parseFloat(pegHeightInput.value), 0.4, 12, 2.5),
    baseBridge: clamp(parseFloat(baseBridgeInput.value), 0, 6, 1.2),
  };
}

function syncMountFields(): void {
  const mount = mountSel.value;
  for (const el of document.querySelectorAll('.mount-magnet')) {
    el.toggleAttribute('hidden', mount !== 'magnet');
  }
  for (const el of document.querySelectorAll('.mount-peg')) {
    el.toggleAttribute('hidden', mount !== 'peg');
  }
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

    setStatus('', 'ok');
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
  const count = clamp(Math.round(parseFloat(countInput.value)), 1, 500, 1);
  const blob = buildThreeMf(currentModel, currentName, count);
  const suffix = count > 1 ? `_x${count}` : '';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentName}${suffix}.3mf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let debounce = 0;
function scheduleRegenerate(): void {
  clearTimeout(debounce);
  debounce = window.setTimeout(regenerate, 120);
}

mountSel.addEventListener('change', () => {
  syncMountFields();
  scheduleRegenerate();
});

for (const el of [
  sidcInput, sizeInput, baseInput, lineInput,
  magDiaInput, magDepthInput, pegWidthInput, pegLengthInput, pegHeightInput,
  baseBridgeInput,
]) {
  el.addEventListener('input', scheduleRegenerate);
}
downloadBtn.addEventListener('click', download);

syncMountFields();
regenerate();
