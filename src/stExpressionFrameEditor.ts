import type { StExpressionImageOptions } from "./types";

const STYLE_ID = "bst-st-frame-editor-style";
const BACKDROP_CLASS = "bst-st-frame-editor-backdrop";
const MODAL_CLASS = "bst-st-frame-editor";

const DEFAULT_ST_EXPRESSION_FRAME: StExpressionImageOptions = {
  zoom: 1.2,
  positionX: 50,
  positionY: 20,
};

const PREVIEW_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#3f8db7"/>
        <stop offset="100%" stop-color="#2e3550"/>
      </linearGradient>
      <linearGradient id="hair" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffb2d6"/>
        <stop offset="100%" stop-color="#ff77b8"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="42" fill="url(#bg)"/>
    <circle cx="256" cy="120" r="66" fill="#f7c9ce"/>
    <ellipse cx="256" cy="100" rx="96" ry="80" fill="url(#hair)"/>
    <rect x="190" y="190" width="132" height="188" rx="64" fill="#2a2f42"/>
    <ellipse cx="220" cy="122" rx="7" ry="6" fill="#51322d"/>
    <ellipse cx="292" cy="122" rx="7" ry="6" fill="#51322d"/>
    <path d="M232 154c9 12 39 12 48 0" fill="none" stroke="#bf6f7b" stroke-width="5" stroke-linecap="round"/>
    <circle cx="72" cy="430" r="42" fill="rgba(255,255,255,0.15)"/>
    <circle cx="452" cy="78" r="34" fill="rgba(255,255,255,0.12)"/>
  </svg>`,
)}`;

export type OpenStExpressionFrameEditorInput = {
  title?: string;
  description?: string;
  initial: StExpressionImageOptions;
  fallback?: StExpressionImageOptions;
  previewChoices?: Array<{ name: string; imageUrl: string }>;
  selectedPreviewName?: string;
  onPreviewNameChange?: (name: string) => void;
  emptyPreviewText?: string;
  onChange?: (next: StExpressionImageOptions) => void;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function sanitizeStExpressionFrame(
  raw: Partial<StExpressionImageOptions> | null | undefined,
  fallback: StExpressionImageOptions = DEFAULT_ST_EXPRESSION_FRAME,
): StExpressionImageOptions {
  const zoom = clamp(round(toNumber(raw?.zoom) ?? fallback.zoom, 2), 0.5, 3);
  const positionX = clamp(Math.round(toNumber(raw?.positionX) ?? fallback.positionX), 0, 100);
  const positionY = clamp(Math.round(toNumber(raw?.positionY) ?? fallback.positionY), 0, 100);
  return { zoom, positionX, positionY };
}

export function formatStExpressionFrameSummary(value: StExpressionImageOptions): string {
  return `Zoom ${value.zoom.toFixed(2)} | X ${value.positionX}% | Y ${value.positionY}%`;
}

function ensureEditorStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.${BACKDROP_CLASS} {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.56);
  z-index: 2147483002;
}
.${MODAL_CLASS} {
  position: fixed;
  z-index: 2147483003;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(740px, calc(100vw - 20px));
  max-height: calc(100dvh - 20px);
  overflow: auto;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.2);
  background:
    radial-gradient(900px 280px at 0% 0%, rgba(255, 96, 128, 0.16), transparent 55%),
    radial-gradient(720px 240px at 100% 0%, rgba(81, 177, 255, 0.14), transparent 55%),
    #111626;
  color: #f4f7ff;
  box-shadow: 0 24px 80px rgba(0,0,0,0.56);
  padding: 14px;
  font-family: "Segoe UI", "Trebuchet MS", sans-serif;
}
.${MODAL_CLASS} h4 {
  margin: 0;
  font-size: 18px;
}
.${MODAL_CLASS} p {
  margin: 6px 0 0;
  font-size: 12px;
  opacity: 0.82;
}
.${MODAL_CLASS} .bst-st-frame-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.${MODAL_CLASS} .bst-st-frame-close {
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: 9px;
  background: rgba(14, 18, 30, 0.85);
  color: #fff;
  width: 36px;
  min-width: 36px;
  height: 36px;
  font-size: 20px;
  cursor: pointer;
}
.${MODAL_CLASS} .bst-st-frame-close:hover {
  border-color: rgba(255,255,255,0.45);
}
.${MODAL_CLASS} .bst-st-frame-layout {
  margin-top: 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.${MODAL_CLASS} .bst-st-frame-layout-empty {
  margin-top: 18px;
  min-height: 280px;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 12px;
  background: rgba(12, 16, 27, 0.72);
  display: grid;
  place-items: center;
  text-align: center;
  padding: 14px;
}
.${MODAL_CLASS} .bst-st-frame-layout-empty p {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  opacity: 0.9;
  max-width: 480px;
}
.${MODAL_CLASS} .bst-st-frame-preview-card {
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 12px;
  background: rgba(12, 16, 27, 0.72);
  padding: 12px;
  display: grid;
  gap: 8px;
  justify-items: center;
}
.${MODAL_CLASS} .bst-st-frame-preview-title {
  font-size: 12px;
  opacity: 0.88;
}
.${MODAL_CLASS} .bst-st-frame-preview-picker {
  width: 100%;
  display: grid;
  gap: 4px;
}
.${MODAL_CLASS} .bst-st-frame-preview-picker label {
  font-size: 11px;
  opacity: 0.78;
}
.${MODAL_CLASS} .bst-st-frame-preview-picker select {
  width: 100%;
  background: rgba(16, 20, 32, 0.9);
  color: #f4f7ff;
  border: 1px solid rgba(255,255,255,0.24);
  border-radius: 8px;
  padding: 6px 8px;
}
.${MODAL_CLASS} .bst-st-frame-preview-picker select:disabled {
  opacity: 0.78;
}
.${MODAL_CLASS} .bst-st-frame-preview-frame {
  --bst-st-frame-zoom: 1.2;
  --bst-st-frame-pos-x: 50%;
  --bst-st-frame-pos-y: 20%;
  width: min(240px, 44vw);
  aspect-ratio: 1 / 1;
  border-radius: 16px;
  overflow: hidden;
  border: 2px solid rgba(255,255,255,0.24);
  box-shadow: 0 12px 24px rgba(0,0,0,0.38), 0 0 0 1px rgba(0,0,0,0.35);
  background: rgba(0,0,0,0.24);
}
.${MODAL_CLASS} .bst-st-frame-preview-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: var(--bst-st-frame-pos-x) var(--bst-st-frame-pos-y);
  transform: scale(var(--bst-st-frame-zoom));
  transform-origin: var(--bst-st-frame-pos-x) var(--bst-st-frame-pos-y);
  display: block;
}
.${MODAL_CLASS} .bst-st-frame-controls {
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 12px;
  background: rgba(12, 16, 27, 0.72);
  padding: 12px;
  display: grid;
  gap: 10px;
}
.${MODAL_CLASS} .bst-st-frame-control label {
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 5px;
}
.${MODAL_CLASS} .bst-st-frame-range-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.${MODAL_CLASS} input[type="range"] {
  width: 100%;
  accent-color: #53b7ff;
}
.${MODAL_CLASS} .bst-st-frame-stepper {
  display: inline-flex;
  gap: 5px;
}
.${MODAL_CLASS} .bst-st-frame-stepper button,
.${MODAL_CLASS} .bst-st-frame-pad button,
.${MODAL_CLASS} .bst-st-frame-actions button {
  border: 1px solid rgba(255,255,255,0.24);
  border-radius: 8px;
  background: rgba(19, 24, 37, 0.86);
  color: #fff;
  cursor: pointer;
  padding: 7px 10px;
  font-size: 12px;
}
.${MODAL_CLASS} .bst-st-frame-stepper button:hover,
.${MODAL_CLASS} .bst-st-frame-pad button:hover,
.${MODAL_CLASS} .bst-st-frame-actions button:hover {
  border-color: rgba(255,255,255,0.48);
  background: rgba(27, 34, 52, 0.95);
}
.${MODAL_CLASS} .bst-st-frame-pad {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.${MODAL_CLASS} .bst-st-frame-pad .bst-empty {
  background: transparent;
  border: 0;
  pointer-events: none;
}
.${MODAL_CLASS} .bst-st-frame-actions {
  margin-top: 2px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.${MODAL_CLASS} .bst-st-frame-actions .bst-st-frame-primary {
  background: rgba(71, 145, 255, 0.26);
  border-color: rgba(129, 186, 255, 0.55);
}
@media (max-width: 820px) {
  .${MODAL_CLASS} {
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    left: 0;
    top: 0;
    transform: none;
    padding: 12px;
  }
  .${MODAL_CLASS} .bst-st-frame-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .${MODAL_CLASS} .bst-st-frame-preview-frame {
    width: min(260px, 64vw);
  }
  .${MODAL_CLASS} .bst-st-frame-preview-picker select {
    font-size: 16px;
    padding: 8px 10px;
  }
}
  `;
  document.head.appendChild(style);
}

export function closeStExpressionFrameEditor(): void {
  document.querySelector(`.${BACKDROP_CLASS}`)?.remove();
  document.querySelector(`.${MODAL_CLASS}`)?.remove();
}

export function openStExpressionFrameEditor(input: OpenStExpressionFrameEditorInput): void {
  ensureEditorStyles();
  closeStExpressionFrameEditor();

  const fallback = sanitizeStExpressionFrame(input.fallback ?? DEFAULT_ST_EXPRESSION_FRAME, DEFAULT_ST_EXPRESSION_FRAME);
  let current = sanitizeStExpressionFrame(input.initial, fallback);
  const previewChoices = (input.previewChoices ?? [])
    .map(item => ({ name: String(item.name ?? "").trim(), imageUrl: String(item.imageUrl ?? "").trim() }))
    .filter(item => item.name && item.imageUrl);
  const hasPreview = previewChoices.length > 0;
  const initialChoice = previewChoices.find(item => item.name === input.selectedPreviewName) ?? previewChoices[0] ?? null;
  let selectedPreviewName = initialChoice?.name ?? "";

  const backdrop = document.createElement("div");
  backdrop.className = BACKDROP_CLASS;
  backdrop.addEventListener("click", () => closeStExpressionFrameEditor());
  document.body.appendChild(backdrop);

  const modal = document.createElement("div");
  modal.className = MODAL_CLASS;
  modal.innerHTML = `
    <div class="bst-st-frame-top">
      <div>
        <h4>${input.title ?? "Adjust ST Expression Framing"}</h4>
        <p>${input.description ?? "Preview and adjust zoom plus crop position for ST expression mood images."}</p>
      </div>
      <button type="button" class="bst-st-frame-close" data-action="close" title="Close">&times;</button>
    </div>
    ${hasPreview ? `
    <div class="bst-st-frame-layout">
      <div class="bst-st-frame-preview-card">
        <div class="bst-st-frame-preview-title">Mood card preview</div>
        <div class="bst-st-frame-preview-frame" data-role="previewFrame">
          <img src="${escapeHtml(initialChoice?.imageUrl ?? PREVIEW_IMAGE)}" alt="ST expression framing preview" data-role="previewImage">
        </div>
        <div class="bst-st-frame-preview-picker">
          <label>Preview Character</label>
          <select data-role="previewCharacter"${previewChoices.length <= 1 ? " disabled" : ""}>
            ${previewChoices.map(choice => `
              <option value="${escapeHtml(choice.name)}"${choice.name === selectedPreviewName ? " selected" : ""}>${escapeHtml(choice.name)}</option>
            `).join("")}
          </select>
        </div>
      </div>
      <div class="bst-st-frame-controls">
        <div class="bst-st-frame-control">
          <label>Zoom <strong data-role="zoomValue"></strong></label>
          <div class="bst-st-frame-range-row">
            <input type="range" min="0.5" max="3" step="0.05" data-role="zoomRange">
            <div class="bst-st-frame-stepper">
              <button type="button" data-action="zoomStep" data-step="-0.05">-</button>
              <button type="button" data-action="zoomStep" data-step="0.05">+</button>
            </div>
          </div>
        </div>
        <div class="bst-st-frame-control">
          <label>Position X <strong data-role="xValue"></strong></label>
          <div class="bst-st-frame-range-row">
            <input type="range" min="0" max="100" step="1" data-role="xRange">
            <div class="bst-st-frame-stepper">
              <button type="button" data-action="xStep" data-step="-1">-</button>
              <button type="button" data-action="xStep" data-step="1">+</button>
            </div>
          </div>
        </div>
        <div class="bst-st-frame-control">
          <label>Position Y <strong data-role="yValue"></strong></label>
          <div class="bst-st-frame-range-row">
            <input type="range" min="0" max="100" step="1" data-role="yRange">
            <div class="bst-st-frame-stepper">
              <button type="button" data-action="yStep" data-step="-1">-</button>
              <button type="button" data-action="yStep" data-step="1">+</button>
            </div>
          </div>
        </div>
        <div class="bst-st-frame-control">
          <label>Position pad <strong>nudge by 2%</strong></label>
          <div class="bst-st-frame-pad">
            <button type="button" class="bst-empty" aria-hidden="true"></button>
            <button type="button" data-action="nudge" data-dx="0" data-dy="-2">Up</button>
            <button type="button" class="bst-empty" aria-hidden="true"></button>
            <button type="button" data-action="nudge" data-dx="-2" data-dy="0">Left</button>
            <button type="button" data-action="center">Center</button>
            <button type="button" data-action="nudge" data-dx="2" data-dy="0">Right</button>
            <button type="button" class="bst-empty" aria-hidden="true"></button>
            <button type="button" data-action="nudge" data-dx="0" data-dy="2">Down</button>
            <button type="button" class="bst-empty" aria-hidden="true"></button>
          </div>
        </div>
        <div class="bst-st-frame-actions">
          <button type="button" data-action="reset">Reset to defaults</button>
          <button type="button" class="bst-st-frame-primary" data-action="close">Done</button>
        </div>
      </div>
    </div>
    ` : `
    <div class="bst-st-frame-layout-empty">
      <p>${input.emptyPreviewText ?? "At least one character with ST expressions is required to preview framing."}</p>
    </div>
    `}
  `;
  document.body.appendChild(modal);

  if (!hasPreview) {
    modal.querySelectorAll('[data-action="close"]').forEach(node => {
      node.addEventListener("click", () => closeStExpressionFrameEditor());
    });
    return;
  }

  const previewFrame = modal.querySelector('[data-role="previewFrame"]') as HTMLElement | null;
  const previewImage = modal.querySelector('[data-role="previewImage"]') as HTMLImageElement | null;
  const previewCharacter = modal.querySelector('[data-role="previewCharacter"]') as HTMLSelectElement | null;
  const zoomValue = modal.querySelector('[data-role="zoomValue"]') as HTMLElement | null;
  const xValue = modal.querySelector('[data-role="xValue"]') as HTMLElement | null;
  const yValue = modal.querySelector('[data-role="yValue"]') as HTMLElement | null;
  const zoomRange = modal.querySelector('[data-role="zoomRange"]') as HTMLInputElement | null;
  const xRange = modal.querySelector('[data-role="xRange"]') as HTMLInputElement | null;
  const yRange = modal.querySelector('[data-role="yRange"]') as HTMLInputElement | null;

  const applyPreviewCharacter = (): void => {
    if (!previewImage) return;
    const selected = previewChoices.find(item => item.name === selectedPreviewName) ?? previewChoices[0] ?? null;
    if (!selected) return;
    previewImage.src = selected.imageUrl;
    input.onPreviewNameChange?.(selected.name);
  };
  previewCharacter?.addEventListener("change", () => {
    selectedPreviewName = previewCharacter.value;
    applyPreviewCharacter();
  });
  applyPreviewCharacter();

  const applyCurrent = (notify: boolean): void => {
    current = sanitizeStExpressionFrame(current, fallback);
    if (previewFrame) {
      previewFrame.style.setProperty("--bst-st-frame-zoom", current.zoom.toFixed(2));
      previewFrame.style.setProperty("--bst-st-frame-pos-x", `${current.positionX.toFixed(2)}%`);
      previewFrame.style.setProperty("--bst-st-frame-pos-y", `${current.positionY.toFixed(2)}%`);
    }
    if (zoomRange) zoomRange.value = current.zoom.toFixed(2);
    if (xRange) xRange.value = String(current.positionX);
    if (yRange) yRange.value = String(current.positionY);
    if (zoomValue) zoomValue.textContent = current.zoom.toFixed(2);
    if (xValue) xValue.textContent = `${current.positionX}%`;
    if (yValue) yValue.textContent = `${current.positionY}%`;
    if (notify) input.onChange?.({ ...current });
  };

  zoomRange?.addEventListener("input", () => {
    current.zoom = Number(zoomRange.value);
    applyCurrent(true);
  });
  xRange?.addEventListener("input", () => {
    current.positionX = Number(xRange.value);
    applyCurrent(true);
  });
  yRange?.addEventListener("input", () => {
    current.positionY = Number(yRange.value);
    applyCurrent(true);
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-action='zoomStep'], [data-action='xStep'], [data-action='yStep']").forEach(button => {
    button.addEventListener("click", () => {
      const step = Number(button.dataset.step ?? "0");
      if (!Number.isFinite(step) || step === 0) return;
      const action = button.dataset.action ?? "";
      if (action === "zoomStep") current.zoom += step;
      if (action === "xStep") current.positionX += step;
      if (action === "yStep") current.positionY += step;
      applyCurrent(true);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-action='nudge']").forEach(button => {
    button.addEventListener("click", () => {
      const dx = Number(button.dataset.dx ?? "0");
      const dy = Number(button.dataset.dy ?? "0");
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      current.positionX += dx;
      current.positionY += dy;
      applyCurrent(true);
    });
  });

  modal.querySelector('[data-action="center"]')?.addEventListener("click", () => {
    current.positionX = 50;
    current.positionY = 50;
    applyCurrent(true);
  });

  modal.querySelector('[data-action="reset"]')?.addEventListener("click", () => {
    current = { ...fallback };
    applyCurrent(true);
  });

  modal.querySelectorAll('[data-action="close"]').forEach(node => {
    node.addEventListener("click", () => closeStExpressionFrameEditor());
  });

  applyCurrent(false);
}
