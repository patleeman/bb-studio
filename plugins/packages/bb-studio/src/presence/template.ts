import { MAX_CODE } from "./schema";

export const PRESENCE_TEMPLATE_CODE = `function draw(ctx, t, state, palette, size) {
  var c = size / 2;
  var busy = state.name === "thinking";
  var r = size * 0.3 * (1 + 0.05 * Math.sin(t * 2));
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, size / 24);
  for (var k = 0; k < 3; k++) {
    var a = t * (0.6 + 0.2 * k) + k * 2.1;
    ctx.strokeStyle = palette[k];
    ctx.globalAlpha = busy ? 0.6 + 0.4 * Math.sin(state.clock * 9 + k) : 0.9;
    ctx.beginPath();
    ctx.ellipse(c, c, r, r * (0.35 + 0.2 * k), a, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette[2];
  ctx.beginPath();
  ctx.arc(c, c, size * (busy ? 0.1 : 0.06), 0, Math.PI * 2);
  ctx.fill();
  if (state.name === "working") {
    ctx.strokeStyle = palette[2];
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(1, size / 60);
    ctx.beginPath();
    ctx.arc(c, c, size * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (var w = 0; w < Math.max(1, state.workers); w++) {
      var o = state.clock * 2.2 + (w * Math.PI * 2) / Math.max(1, state.workers);
      ctx.beginPath();
      ctx.arc(c + Math.cos(o) * size * 0.42, c + Math.sin(o) * size * 0.42, Math.max(1.6, size / 24), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (state.name === "needs") {
    var p = (state.clock * 0.55) % 1;
    ctx.strokeStyle = palette[0];
    ctx.globalAlpha = 1 - p;
    ctx.lineWidth = Math.max(1.1, size / 80);
    ctx.beginPath();
    ctx.arc(c, c, size * (0.34 + 0.14 * p), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
`;

export function presenceTemplateJson(): string {
  return JSON.stringify({ id: "three-rings", name: "Three rings", description: "Three turning rings around a core.", code: PRESENCE_TEMPLATE_CODE }, null, 2);
}

export const PRESENCE_FORMAT_GUIDE = [
  "A presence is the Bot's living icon. It is a package {id, name, description, code}: id is lowercase letters, digits and dashes; code is plain JavaScript that declares one top-level function:",
  "  function draw(ctx, t, state, palette, size)",
  "- ctx: a 2D canvas context (OffscreenCanvas), cleared and reset before every call, in CSS pixels; the picture is size × size with the origin at the top left. Leave the background transparent.",
  "- t: seconds of presence time. It already runs faster while thinking and follows the user's motion setting, so animate from t alone. The same t must draw the same frame: no Math.random, no Date, no state kept between calls.",
  "- state: {name, workers, clock}. name is \"idle\", \"thinking\", \"working\" or \"needs\"; workers is how many workers run; clock is unscaled seconds for pulses.",
  "- palette: three \"#rrggbb\" strings, [main, depth, highlight], from the Bot's theme or its custom color. In the needs state the palette is already amber.",
  "- size: 24 in the Bot switcher, 36 in the sidebar header, up to 280 in the picker. Below 30 px draw a simplified shape with strokes of at least 1 px; fine detail turns to blur.",
  "The four states must look different at a glance, also at 24 and 36 px: idle breathes slowly; thinking adds a shimmer or flicker; working shows one orbiting dot per worker; needs adds pulse rings (the amber palette alone is not enough for the check).",
  `Limits: at most ${MAX_CODE} characters; a frame at 160 px in about 6 ms; no network, DOM, window, timers, import, eval, classes or prototypes. The code runs sealed in a sandboxed worker with only its ctx; a presence that throws or stalls is replaced by a built-in form.`,
  "Checks before saving: it starts and draws; at 24, 36 and 160 px each state covers at least 2% of the picture; frame time; every pair of states differs when drawn at the same t with the same palette (speed and amber alone do not count); at 24 px in a light palette on a white ground, each state stands out on at least 2% of the picture and every pair of states differs by 2%; idle moves; the same t gives the same frame.",
  "On a light ground the palette is darker ink and BB draws a thin outline and a state glow behind the picture; draw for a transparent background either way.",
].join("\n");
