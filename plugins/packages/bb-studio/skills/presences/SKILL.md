---
name: presences
description: Use when creating, updating, or customizing a Bot presence (living icon) with the presence tool — draw() canvas contract, four states, sandbox limits, validation checks, and a working template.
---

# BB Studio Presences

A presence is a Bot's living icon. Use the `presence` tool with `op`: `"list"` (`id` prints stored package + code), `"create"` (`id`, `name`, `code`, `description?`), `"update"` (`id`, `name?`/`description?`/`code?`, `newId?` to copy), `"apply"` (`form?`, `bot?`, `color?`, `motion?`), or `"delete"` (`id`).

`op: "create"` and `op: "update"` run every check in a sandbox in an open BB Studio window before saving; a failure saves nothing and lists each failed check.

## Contract

A presence is `{id, name, description, code}`:
- `id`: lowercase letters, digits and dashes (2–40 chars), must be new.
- `code`: plain JavaScript declaring one top-level function:

```js
function draw(ctx, t, state, palette, size)
```

- `ctx`: 2D canvas context (`OffscreenCanvas`), cleared and reset before every call, in CSS pixels; picture is `size × size` with origin at top-left. Leave the background transparent.
- `t`: seconds of presence time (already scaled for thinking speed and the user's motion setting). Animate from `t` alone. The same `t` must draw the same frame: no `Math.random`, no `Date`, no state kept between calls.
- `state`: `{name, workers, clock}`. `name` is `"idle"`, `"thinking"`, `"working"` or `"needs"`; `workers` is how many workers run; `clock` is unscaled seconds for pulses.
- `palette`: three `"#rrggbb"` strings `[main, depth, highlight]` from the Bot's theme or custom color. In `"needs"`, the palette is already amber.
- `size`: 24 in the Bot switcher, 36 in the sidebar header, up to 280 in the picker. Below 30 px draw a simplified shape with strokes of at least 1 px; fine detail blurs.

## Four states (must differ at a glance at 24 and 36 px)

- `idle`: breathes slowly.
- `thinking`: adds a shimmer or flicker.
- `working`: shows one orbiting dot per worker.
- `needs`: adds pulse rings (amber palette alone is not enough for the check).

## Limits and checks

- At most 16,384 characters; a frame at 160 px in about 6 ms.
- No network, DOM, `window`, timers, `import`, `eval`, classes or prototypes. Runs sealed in a sandboxed worker with only its `ctx`; a presence that throws or stalls falls back to a built-in form.
- Checks before saving: starts and draws; at 24, 36 and 160 px each state covers >= 2% of the picture; frame time; every pair of states differs at the same `t` and same `palette` (speed and amber alone don't count); at 24 px in a light palette on white ground each state stands out >= 2% and every pair differs >= 2%; `idle` moves; the same `t` gives the same frame.
- On a light ground the palette is darker ink and BB draws a thin outline and state glow behind the picture; draw for a transparent background either way.

## Working template

```js
function draw(ctx, t, state, palette, size) {
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
```
