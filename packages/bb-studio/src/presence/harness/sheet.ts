import { BUILTIN_FORMS, drawPresence, FORM_NAMES, PRESENCE_STATES, STATE_NAMES, type Palette } from "../forms";

declare const SHEET_LIGHT: boolean;
declare const SHEET_ZOOM: boolean;

const palette: Palette = SHEET_LIGHT ? [[9, 105, 218], [26, 127, 55], [154, 103, 0]] : [[255, 79, 216], [123, 47, 247], [79, 240, 255]];
const ink = SHEET_LIGHT ? "#1f2328" : "#f3ecff";
const sizes = SHEET_ZOOM ? [36, 24] : [160, 36, 24];
const zoom = SHEET_ZOOM ? 4 : 1;
const dpr = SHEET_ZOOM ? 2 : Math.min(2, window.devicePixelRatio || 1);

const root = document.createElement("div");
root.style.cssText = `display:grid;grid-template-columns:110px repeat(4,auto);gap:${SHEET_ZOOM ? 10 : 14}px 22px;padding:20px;font:12px -apple-system,system-ui,sans-serif;color:${ink};align-items:center;width:max-content`;
root.append(document.createElement("span"));
for (const state of PRESENCE_STATES) {
  const head = document.createElement("div");
  head.textContent = STATE_NAMES[state];
  head.style.cssText = "font-weight:600;font-size:13px";
  root.append(head);
}
BUILTIN_FORMS.forEach((form, row) => {
  const label = document.createElement("div");
  label.textContent = FORM_NAMES[form];
  label.style.fontWeight = "600";
  root.append(label);
  for (const state of PRESENCE_STATES) {
    const cell = document.createElement("div");
    cell.style.cssText = "display:flex;align-items:center;gap:12px";
    for (const size of sizes) {
      const canvas = document.createElement("canvas");
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.cssText = `width:${size * zoom}px;height:${size * zoom}px;image-rendering:pixelated`;
      drawPresence(canvas.getContext("2d")!, { form, size, dpr, clock: 2.2 + row * 0.37, formTime: 5.5 + row * 1.3, state, workers: size >= 70 ? 3 : 2, palette, light: SHEET_LIGHT });
      cell.append(canvas);
    }
    root.append(cell);
  }
});
const wrap = document.createElement("div");
wrap.style.cssText = "display:inline-block";
if (!SHEET_ZOOM) {
  const strip = document.createElement("div");
  strip.style.cssText = `display:flex;gap:8px;padding:0 20px 20px;align-items:center;font:12px -apple-system,system-ui,sans-serif;color:${ink}`;
  const label = document.createElement("div");
  label.textContent = "Polyhedron morph";
  label.style.cssText = "width:110px;font-weight:600";
  strip.append(label);
  for (let k = 0; k < 12; k++) {
    const canvas = document.createElement("canvas");
    canvas.width = 84 * dpr; canvas.height = 84 * dpr;
    canvas.style.cssText = "width:84px;height:84px";
    drawPresence(canvas.getContext("2d")!, { form: "poly", size: 84, dpr, clock: 1, formTime: ((k % 3) * 0.2 + 0.6 + Math.floor(k / 3)) / 0.3, state: "idle", workers: 0, palette, light: SHEET_LIGHT });
    strip.append(canvas);
  }
  wrap.append(root, strip);
} else wrap.append(root);
document.body.append(wrap);
const box = wrap.getBoundingClientRect();
(window as unknown as { __done: { width: number; height: number } }).__done = { width: Math.ceil(box.width), height: Math.ceil(box.height) };
