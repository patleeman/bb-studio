import { FRAME_BUDGET_MS, FRAME_SIZE, STATIC_BUDGET } from "./checks";
import { HALO, HALO_STROKE_PX, TEXT_MIN, UI_MIN } from "./look";
import { MAX_CARDS, MAX_RIPPLES, MAX_WORKERS, OPEN_ROOM, PRELUDE, RIPPLE_SECONDS } from "./scene/contract";
import type { ThemePackage } from "./schema";

export const TEMPLATE_SHADER = `uniform float u_bands;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 bg = u_palette[0];
  float t = u_time * 0.25;
  float wave = sin(uv.x * 5.0 + t) * 0.05 + sin(uv.x * 11.0 - t * 1.6) * 0.02;
  float rise = uv.y - 0.72 - wave;
  float rays = 0.7 + 0.3 * sin(uv.x * 34.0 + 2.5 * sin(uv.x * 6.0 - t) + t * 0.7);
  float band = exp(-abs(rise) * u_bands) * rays;
  float veil = exp(-max(rise, 0.0) * 4.5) * step(0.0, rise) * rays * (0.6 + 0.4 * sin(uv.x * 3.0 - t * 0.5));
  vec3 col = bg + u_palette[1] * band * 0.55 + u_palette[2] * band * band * 0.25 + u_palette[1] * veil * 0.14;
  col += mix(u_palette[2], u_palette[1], uv.y) * 0.12 * (1.0 - uv.y);

  float strip = max(u_resolution.x - u_clear.z, 0.0);
  vec2 orb = strip > 0.09 * u_resolution.x ? vec2((u_clear.z + 0.5 * strip) / u_resolution.x, 0.8) : vec2(0.85, 0.8);
  float od = length((uv - orb) * vec2(aspect, 1.0));
  float radius = clamp(0.25 * strip / u_resolution.y, 0.04, 0.1);
  col = mix(col, u_palette[3] * 0.9, smoothstep(radius + 0.003, radius, od));
  col += u_palette[3] * 0.22 * exp(-max(od - radius, 0.0) * 30.0);

  for (int i = 0; i < ${MAX_WORKERS}; i++) {
    vec4 w = u_workers[i];
    if (w.z < 0.5) continue;
    vec2 p = vec2(mix(u_open.x, u_open.z, 0.5 + 0.3 * sin(w.y * 0.2 + w.x * 6.28)) / u_resolution.x, 0.72 + sin(w.y * 0.4 + w.x * 6.28) * 0.04);
    float d = length((uv - p) * vec2(aspect, 1.0));
    col += u_workerColor * openFade(gl_FragCoord.xy) * step(u_open.x + 1.0, u_open.z) * (exp(-d * 120.0) * 1.2 + exp(-d * 30.0) * 0.2);
  }

  col += u_needsYouColor * u_needsYou * exp(-uv.y * 24.0) * (0.6 + 0.4 * sin(u_time * 3.0));

  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = u_ripples[i];
    if (r.w < 0.5) continue;
    float d = length((uv - r.xy) * vec2(aspect, 1.0));
    float fade = clamp(1.0 - r.z / ${RIPPLE_SECONDS.toFixed(1)}, 0.0, 1.0);
    vec3 rc = r.w > 1.5 ? u_errorColor : u_finishedColor;
    col += rc * exp(-abs(d - r.z * 0.3) * 60.0) * fade;
  }

  gl_FragColor = vec4(mix(bg, col, u_intensity), 1.0);
}
`;

export const THEME_TEMPLATE: ThemePackage = {
  format: 1,
  id: "northern-lights",
  name: "Northern Lights",
  kind: "scene",
  palette: ["#04070f", "#3ee8a8", "#b98cff", "#ffe08a"],
  variants: {
    dark: { canvas: "#070b14", ink: "#e8f1ff", sidebar: "#0a101c", accent: "#3ee8a8", accentInk: "#03140d", selection: "#3ee8a8", error: "#ff5d73", warning: "#ffb347", success: "#5df0a0" },
  },
  glass: {
    sidebar: { opacity: 0.14, blur: 6 },
    main: { opacity: 0.03, blur: 0 },
    transcript: { opacity: 0.16, blur: 6 },
    composer: { opacity: 0.42, blur: 10 },
    hud: { opacity: 0.72, blur: 20 },
    saturate: 1.15,
    edge: null,
  },
  type: { heading: `-apple-system, "SF Pro Display", system-ui, sans-serif`, body: `-apple-system, "SF Pro Text", system-ui, sans-serif`, mono: `ui-monospace, "SF Mono", Menlo, monospace` },
  radius: 6,
  motion: { speed: 1, crossfadeMs: 700 },
  effects: {
    worker: { color: "#ffe08a", character: "a drifting star" },
    needsYou: { color: "#ffb347" },
    finished: { color: "#3ee8a8" },
    error: { color: "#ff5d73" },
  },
  defaults: { intensity: 0.8, glass: 0.6, motion: 0.5 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: TEMPLATE_SHADER,
    uniforms: { u_bands: 9 },
    fallback: { color: "#04070f", image: null },
    still: 8,
    backdrop: { dark: "#04070f", light: "#8acdbd" },
  },
  credit: null,
};

export const THEME_FORMAT_GUIDE = `A theme package is JSON:
- format: 1. id: lowercase letters, digits and dashes (≤48), not a built-in id. name: ≤40 chars.
- kind: "scene" (live shader behind glass) or "classic" (no scene, solid surfaces: scene {"kind":"none"}, glass null).
- palette: 4 hex colors [background, accent, highlight, worker]; the shader reads them as u_palette[0..3].
- variants: {dark?, light?}, at least one; each {canvas, ink, sidebar, accent, accentInk, selection, error, warning, success} as #rrggbb.
- glass (scene only): {sidebar, main, transcript, composer, hud} each {opacity 0–1, blur 0–48}, saturate 1–2, edge hex or null. The window is floating cards over the scene with gutters between them: sidebar is the sidebar's cards (the Bot's pages, the conversation and worker lists, the switcher, the rail); transcript is the transcript card, every other page's content column card and the header's pills; composer is the composer and the side panel; hud is the HUD and, with a 12 px blur, every menu, popover, tooltip, dialog and the command bar, the most opaque (about 0.7–0.8); main is a tint over the open gutters (0–0.05 keeps the scene clear). Opacity is the share of the variant's canvas (sidebar: its sidebar color) over the blurred scene: about 0.12–0.25 with a 10–14 px blur is clear glass with the scene's shapes and colors showing through, the composer densest at about 0.4–0.5. Text on the sidebar and transcript cards carries a halo in the canvas color; the halo keeps text readable, not the tint. The sidebar's opacity is at most the transcript's and the composer's; main's is at most the transcript's. main left out is {opacity 0.18, blur 0}. glass.modes {light, dark} may give any of the five surfaces its own {opacity, blur} for that variant: a bright, detailed scene under dark text wants denser, more blurred cards (transcript about 0.6 at 14 px).
- type: {heading, body, mono} CSS font stacks (letters, digits, spaces, quotes, commas, dashes); optional transcript stack; optional headingWeight 100–900 in hundreds, the weight of every heading outside a transcript (left out, each heading keeps its own). Jost is bundled; other names are system fonts.
- radius 0–16. motion: {speed 0–4, crossfadeMs 0–3000}.
- effects: worker {color, character: what a running worker is in the scene, ≤40 chars}, needsYou {color}, finished {color}, error {color}.
- defaults: {intensity, glass, motion} 0–1; a scene's glass and motion start above 0.
- scene: {kind:"shader", language:"glsl-es-100", source, uniforms: {u_name: number | [2–4 numbers] | "#rrggbb"}, fallback: {color, image: PNG/JPEG/WebP data URL or null}, still: seconds 0–600 of the frame shown under reduced motion, backdrop: {dark, light, modes?: {light?: {dark, light}, dark?: {dark, light}}}: the darkest and brightest colors the scene shows behind text, and for a theme with two variants optionally each variant's own range}.
- credit: {source https URL, license, copyright} or null.

Shader contract (GLSL ES 1.00 fragment shader; write only your functions and main):
The engine prepends this prelude, so don't declare these uniforms or precision:
${PRELUDE}
- u_clear (vec4: left, bottom, right, top, in gl_FragCoord pixels) is where the transcript column sits in a window of this size (it does not follow the page). Put the scene's focal element (a sun, a moon, the brightest shape) beside it, for example centered in the strip from u_clear.z to u_resolution.x and sized to that strip, falling back to a fixed spot when the strip is under about 9% of the width. Without a window it is the card of a 1600×1000 window (x 580–1340, y 48–880 from the top).
- u_open (vec4: left, bottom, right, top, in gl_FragCoord pixels) is the largest area no card covers: the strip right of the transcript column, or the gap the side panel leaves; it follows the window's size, the sidebar's width and the side panel, eased, and has no width when no area is at least ${OPEN_ROOM} px wide. u_cards[i] (${MAX_CARDS}, same layout as u_clear) are the sidebar, the transcript column and the side panel, zero when absent. Cards are frosted glass, so a crisp moving shape that passes under one looks cut at its edge. Keep every focal mover (workers, anything with a trail or a glow) inside u_open: loop or sweep it there, shrink and slow it as the area narrows, hide it when u_open has no width, and multiply all it draws by openFade(gl_FragCoord.xy), which is 1 in the open and falls to 0 about 4.5% of the height before any card's edge. openFade(gl_FragCoord.xy, inset) takes the inset in pixels (0 within it of a card's edge, 1 from 2.2 times it), for subjects sized to fit a narrow area. Never send a mover across the window.
- u_time is scene seconds, already scaled by the theme's speed and the Bot's motion slider; under reduced motion it stays at scene.still. Give the scene slow ambient motion from u_time that never stops: drift, sway or flow in large soft shapes that still read through the cards' blur, in loops of about 20–60 s at motion.speed 1, nothing fast or blinking, and no jumps (change what a loop shows only while it is faded out). Pick scene.still as a frame that looks composed.
- u_intensity 0–1, the Intensity slider: 1 is the scene at full strength, lower fades toward u_palette[0], as gl_FragColor = vec4(mix(bg, col, u_intensity), 1.0). Ship defaults.intensity at 0.7–0.85 and keep the scene's mood: dark scenes stay dark, with one bright focal element beside the transcript card.
- u_workers[i] (${MAX_WORKERS}): x seed 0–1, y seconds running, z 1 when the slot is a running worker; draw it as effects.worker.character in u_workerColor.
- u_ripples[i] (${MAX_RIPPLES}): x, y center in 0–1, z seconds since it started (fade by ${RIPPLE_SECONDS} s), w 1 finished (u_finishedColor) or 2 error (u_errorColor).
- u_needsYou 0–1: glow in u_needsYouColor while a conversation waits on the user.
- u_layer is a picture a built-in scene's own code draws (Tonight's Sky's stars); it is empty for a theme you write.
- Declare each custom uniform (uniform float u_bands;) and give its value in scene.uniforms.
- No while loops, no #extension, for loops with constant bounds, write gl_FragColor.

Checks before save: contrast of text ≥ ${TEXT_MIN} and UI ≥ ${UI_MIN} on every surface in every variant, at the default settings and at full intensity with no glass, on the card's glass over the declared backdrop, with the halo counted on the sidebar and transcript cards at its coverage on the edge of a ${HALO_STROKE_PX} px stroke (${Math.round(HALO * 100)}%) and text there ≥ ${UI_MIN} without it (dark text on a light variant ≥ ${TEXT_MIN}, and its muted text ≥ ${UI_MIN}); the glass rises at run time to the least opacity that reads; frame time ≤ ${FRAME_BUDGET_MS} ms at ${FRAME_SIZE.width}×${FRAME_SIZE.height} on a GPU when an app window is open, else a static estimate ≤ ${STATIC_BUDGET} weighted calls per pixel (sin/pow/exp 4, sqrt/length 2, texture2D 8, mix/clamp 1, times loop counts); backdrop: the brightest pixel behind text at scene.still (the sidebar, the header row and the transcript card and composer of a 1600×1000 window, blurred as much as the least blurred glass) is no brighter than backdrop.light; a reduced-motion still frame. Set backdrop.light to the brightest blurred color behind those cards and backdrop.dark to the darkest; a brighter backdrop.light makes the glass denser.`;

export function themeTemplateJson(): string {
  return JSON.stringify(THEME_TEMPLATE, null, 2);
}
