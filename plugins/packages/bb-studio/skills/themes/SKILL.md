---
name: themes
description: Use when creating, updating, or customizing a BB Studio theme with the theme tool — full JSON package format, GLSL ES 1.00 shader contract, uniforms, glass/contrast checks, and a working template.
---

# BB Studio Themes

Use the `theme` tool with `op`: `"list"` (`id` prints full JSON), `"create"` (`theme`), `"update"` (`id`, `theme`, optional `newId` to copy any theme including built-ins), `"apply"` (`themeId` or `null`, `bot?`, `intensity?`, `glass?`, `motion?`, `effects?`), or `"delete"` (`id`).

`op: "create"` and `op: "update"` run every check before saving; a failure saves nothing and lists each failed check. The `id` must be new and not a built-in id.

## Package format

A theme package is JSON:

- `format`: `1`.
- `id`: lowercase letters, digits and dashes (<=48), not a built-in id.
- `name`: <=40 chars.
- `kind`: `"scene"` (live shader behind glass) or `"classic"` (no scene, solid surfaces: `scene: {"kind":"none"}`, `glass: null`).
- `palette`: 4 hex colors `[background, accent, highlight, worker]`; the shader reads them as `u_palette[0..3]`.
- `variants`: `{dark?, light?}`, at least one; each `{canvas, ink, sidebar, accent, accentInk, selection, error, warning, success}` as `#rrggbb`.
- `glass` (scene only): `{sidebar, main, transcript, composer, hud}` each `{opacity 0–1, blur 0–48}`, `saturate` 1–2, `edge` hex or null. The window is floating cards over the scene with gutters between them:
  - `sidebar`: the sidebar's cards (Bot pages, conversation and worker lists, switcher, rail).
  - `transcript`: the transcript card, every other page's content column card and the header's pills.
  - `composer`: the composer and the side panel.
  - `hud`: with a 12 px blur, every menu, popover, tooltip, dialog and the command bar, the most opaque (about 0.7–0.8).
  - `main`: a tint over the open gutters (0–0.05 keeps the scene clear). Left out, defaults to `{opacity: 0.18, blur: 0}`.
  - Opacity is the share of the variant's canvas (`sidebar`: its sidebar color) over the blurred scene: about 0.12–0.25 with a 10–14 px blur is clear glass with the scene's shapes and colors showing through, the composer densest at about 0.4–0.5. Text on the sidebar and transcript cards carries a halo in the canvas color; the halo keeps text readable, not the tint. `sidebar.opacity <= transcript.opacity` and `<= composer.opacity`; `main.opacity <= transcript.opacity`.
  - `glass.modes` `{light, dark}` may give any of the five surfaces its own `{opacity, blur}` for that variant: a bright, detailed scene under dark text wants denser, more blurred cards (transcript about 0.6 at 14 px).
- `type`: `{heading, body, mono}` CSS font stacks (letters, digits, spaces, quotes, commas, dashes); optional `transcript` stack; optional `headingWeight` 100–900 in hundreds (weight of every heading outside a transcript). `Jost` is bundled; other names are system fonts.
- `radius`: 0–16. `motion`: `{speed 0–4, crossfadeMs 0–3000}`.
- `effects`: `worker` `{color, character: what a running worker is in the scene, <=40 chars}`, `needsYou` `{color}`, `finished` `{color}`, `error` `{color}`.
- `defaults`: `{intensity, glass, motion}` 0–1; a scene's `glass` and `motion` start above 0.
- `scene`: `{kind:"shader", language:"glsl-es-100", source, uniforms: {u_name: number | [2–4 numbers] | "#rrggbb"}, fallback: {color, image: PNG/JPEG/WebP data URL or null}, still: seconds 0–600 of the frame shown under reduced motion, backdrop: {dark, light, modes?: {light?: {dark, light}, dark?: {dark, light}}}}` — the darkest and brightest colors the scene shows behind text.
- `credit`: `{source https URL, license, copyright}` or `null`.

## Shader contract (GLSL ES 1.00 fragment shader)

Write only your functions and `main()`. The engine prepends this prelude, so don't declare these uniforms or precision:

```glsl
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform vec3 u_palette[4];
uniform vec4 u_clear;
uniform vec4 u_open;
uniform vec4 u_cards[3];
uniform float u_openFade;
uniform vec4 u_workers[6];
uniform vec3 u_workerColor;
uniform vec4 u_ripples[4];
uniform vec3 u_finishedColor;
uniform vec3 u_errorColor;
uniform float u_needsYou;
uniform vec3 u_needsYouColor;
uniform sampler2D u_layer;
float openFade(vec2 p);
float openFade(vec2 p, float inset);
```

- `u_clear` (`vec4`: left, bottom, right, top in `gl_FragCoord` px): where the transcript column sits. Put the scene's focal element (sun, moon, brightest shape) beside it — e.g. centered in the strip from `u_clear.z` to `u_resolution.x` and sized to that strip, falling back to a fixed spot when the strip is under ~9% of width. Without a window it is `x 580–1340, y 48–880` from the top on 1600x1000.
- `u_open` (`vec4`: left, bottom, right, top in `gl_FragCoord` px): largest area no card covers (eased; zero width when no area is at least 140 px wide). `u_cards[3]` are sidebar, transcript, side panel. Keep every focal mover (workers, trails, glows) inside `u_open`, hide it when `u_open` has no width, and multiply by `openFade(gl_FragCoord.xy)` (or `openFade(gl_FragCoord.xy, inset)`). Never send a mover across the window.
- `u_time`: scene seconds, scaled by `motion.speed` and the Bot's motion slider; stays at `scene.still` under reduced motion. Use slow ambient motion in loops of ~20–60 s, nothing fast or blinking, no jumps. Pick `scene.still` as a composed frame.
- `u_intensity` 0–1: `gl_FragColor = vec4(mix(bg, col, u_intensity), 1.0)`. Ship `defaults.intensity` at 0.7–0.85; keep dark scenes dark with one bright focal element beside the transcript card.
- `u_workers[6]`: `x` seed 0–1, `y` seconds running, `z` 1 when active; draw as `effects.worker.character` in `u_workerColor`.
- `u_ripples[4]`: `x, y` center 0–1, `z` seconds since start (fade by 1.6 s), `w` 1 finished (`u_finishedColor`) or 2 error (`u_errorColor`).
- `u_needsYou` 0–1: glow in `u_needsYouColor` while a conversation waits on the user.
- `u_layer`: empty for agent-written themes.
- Declare each custom uniform (e.g. `uniform float u_bands;`) and give its value in `scene.uniforms`.
- No `while` loops, no `#extension`, `for` loops with constant bounds, must write `gl_FragColor`.

## Checks before save

- Contrast of text >= 4.5 and UI >= 3 on every surface in every variant, at default settings and at full intensity with no glass, over the declared backdrop (with halo counted on sidebar and transcript cards, and text there >= 3 without it; dark text on light >= 4.5 and muted >= 3). Glass rises at runtime to the minimum readable opacity.
- Frame time <= 4 ms at 1280x720 on GPU when a window is open, else static estimate <= 220 weighted calls/pixel (`sin`/`pow`/`exp` 4, `sqrt`/`length` 2, `texture2D` 8, `mix`/`clamp` 1, times loop counts).
- Backdrop: the brightest blurred pixel behind text at `scene.still` (1600x1000) must be no brighter than `backdrop.light`. Set `backdrop.light` to the brightest blurred color behind those cards and `backdrop.dark` to the darkest.

## Working template

Change `id`, `name`, colors, shader and effects to match the user's description:

```json
{
  "format": 1,
  "id": "northern-lights",
  "name": "Northern Lights",
  "kind": "scene",
  "palette": ["#04070f", "#3ee8a8", "#b98cff", "#ffe08a"],
  "variants": {
    "dark": {
      "canvas": "#070b14",
      "ink": "#e8f1ff",
      "sidebar": "#0a101c",
      "accent": "#3ee8a8",
      "accentInk": "#03140d",
      "selection": "#3ee8a8",
      "error": "#ff5d73",
      "warning": "#ffb347",
      "success": "#5df0a0"
    }
  },
  "glass": {
    "sidebar": { "opacity": 0.14, "blur": 6 },
    "main": { "opacity": 0.03, "blur": 0 },
    "transcript": { "opacity": 0.16, "blur": 6 },
    "composer": { "opacity": 0.42, "blur": 10 },
    "hud": { "opacity": 0.72, "blur": 20 },
    "saturate": 1.15,
    "edge": null
  },
  "type": {
    "heading": "-apple-system, \"SF Pro Display\", system-ui, sans-serif",
    "body": "-apple-system, \"SF Pro Text\", system-ui, sans-serif",
    "mono": "ui-monospace, \"SF Mono\", Menlo, monospace"
  },
  "radius": 6,
  "motion": { "speed": 1, "crossfadeMs": 700 },
  "effects": {
    "worker": { "color": "#ffe08a", "character": "a drifting star" },
    "needsYou": { "color": "#ffb347" },
    "finished": { "color": "#3ee8a8" },
    "error": { "color": "#ff5d73" }
  },
  "defaults": { "intensity": 0.8, "glass": 0.6, "motion": 0.5 },
  "scene": {
    "kind": "shader",
    "language": "glsl-es-100",
    "source": "uniform float u_bands;\n\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / u_resolution;\n  float aspect = u_resolution.x / u_resolution.y;\n  vec3 bg = u_palette[0];\n  float t = u_time * 0.25;\n  float wave = sin(uv.x * 5.0 + t) * 0.05 + sin(uv.x * 11.0 - t * 1.6) * 0.02;\n  float rise = uv.y - 0.72 - wave;\n  float rays = 0.7 + 0.3 * sin(uv.x * 34.0 + 2.5 * sin(uv.x * 6.0 - t) + t * 0.7);\n  float band = exp(-abs(rise) * u_bands) * rays;\n  float veil = exp(-max(rise, 0.0) * 4.5) * step(0.0, rise) * rays * (0.6 + 0.4 * sin(uv.x * 3.0 - t * 0.5));\n  vec3 col = bg + u_palette[1] * band * 0.55 + u_palette[2] * band * band * 0.25 + u_palette[1] * veil * 0.14;\n  col += mix(u_palette[2], u_palette[1], uv.y) * 0.12 * (1.0 - uv.y);\n\n  float strip = max(u_resolution.x - u_clear.z, 0.0);\n  vec2 orb = strip > 0.09 * u_resolution.x ? vec2((u_clear.z + 0.5 * strip) / u_resolution.x, 0.8) : vec2(0.85, 0.8);\n  float od = length((uv - orb) * vec2(aspect, 1.0));\n  float radius = clamp(0.25 * strip / u_resolution.y, 0.04, 0.1);\n  col = mix(col, u_palette[3] * 0.9, smoothstep(radius + 0.003, radius, od));\n  col += u_palette[3] * 0.22 * exp(-max(od - radius, 0.0) * 30.0);\n\n  for (int i = 0; i < 6; i++) {\n    vec4 w = u_workers[i];\n    if (w.z < 0.5) continue;\n    vec2 p = vec2(mix(u_open.x, u_open.z, 0.5 + 0.3 * sin(w.y * 0.2 + w.x * 6.28)) / u_resolution.x, 0.72 + sin(w.y * 0.4 + w.x * 6.28) * 0.04);\n    float d = length((uv - p) * vec2(aspect, 1.0));\n    col += u_workerColor * openFade(gl_FragCoord.xy) * step(u_open.x + 1.0, u_open.z) * (exp(-d * 120.0) * 1.2 + exp(-d * 30.0) * 0.2);\n  }\n\n  col += u_needsYouColor * u_needsYou * exp(-uv.y * 24.0) * (0.6 + 0.4 * sin(u_time * 3.0));\n\n  for (int i = 0; i < 4; i++) {\n    vec4 r = u_ripples[i];\n    if (r.w < 0.5) continue;\n    float d = length((uv - r.xy) * vec2(aspect, 1.0));\n    float fade = clamp(1.0 - r.z / 1.6, 0.0, 1.0);\n    vec3 rc = r.w > 1.5 ? u_errorColor : u_finishedColor;\n    col += rc * exp(-abs(d - r.z * 0.3) * 60.0) * fade;\n  }\n\n  gl_FragColor = vec4(mix(bg, col, u_intensity), 1.0);\n}\n",
    "uniforms": { "u_bands": 9 },
    "fallback": { "color": "#04070f", "image": null },
    "still": 8,
    "backdrop": { "dark": "#04070f", "light": "#8acdbd" }
  },
  "credit": null
}
```
