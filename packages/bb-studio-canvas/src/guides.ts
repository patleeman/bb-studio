// The design guide a canvas agent works from, per look: what makes a rich
// board, the kit and token reference, and a few complete components to
// adapt. The first message carries the canvas's guide (agent only), and
// canvas_guide returns it again, e.g. after a compaction.
//
// Examples are written with @@ for a backtick and $[ for "${", so they can
// live in a template literal here; ex() turns them back.
import { LOOK_INFO, TOKEN_HELP, type OrganicLook } from "./looks";

const ex = (source: string) => source.replace(/@@/g, "`").replace(/\$\[/g, "${").trim();

const COMMON = `
Make the board RICH and dense, like a great front page or a briefing someone designed for this exact question. Not a slide, not a grid of plain cards.
- One focus dominates: importance 5 on the lead (often your own lead component, or a headline). Supporting items get 3–4 and orbit it; detail 1–2. The layout places everything automatically: varied sizes, organic clusters, connectors. Never arrange or position things yourself.
- Fewer, denser components beat many sparse ones. Each says something specific: a number with its trend and context, a map that shows where, a timeline that shows when, small multiples that compare, a quote with a voice, a note that points at what matters.
- Generated components come first: kind "custom" with html. It runs in a sandboxed frame that already has this look's tokens (CSS variables), the kit CSS classes and window.cv. The frame grows to its content's height, so never set a height on your outer element and don't leave empty space; its width is the item's width (use cv.width() for charts). No network: no external images, fonts, or scripts.
- Put the numbers in the item's data and draw them with cv.render((data, options) => html), so canvas_update can change data and the user sees it change in place.
- Built-ins when they fit: headline, stat (series → sparkline), quote, note, map, timeline, multiples, line, bar, area, pie, table, list, image (with options.headline: a photo with a headline).
- Relations: relatedTo: ["other-id"] draws a connector to a related item. A note with anchor: "item-id" and point: {x, y} (0–1 inside that item) is placed beside it with a leader line pointing at that spot. Add 1–3 such annotations per board, on the most interesting thing.
- Inline sparklines: in a caption write {spark:3,5,4,8}; in HTML use cv.spark([3,5,4,8]) or <span data-spark="3,5,4,8"></span>. Deltas: {delta:+2.1} in a caption, cv.delta(2.1) in HTML.
- Type: kicker → headline → dek → body, with the cv-* classes or the --cv-t-* scale. Color only with tokens (var(--cv-…)); --cv-blue and --cv-red for the two sides of a race, --cv-good/--cv-bad for change, --cv-c1…--cv-c8 for series.
- size is a hint: s about a quarter of the width, m a third, l half, xl two-thirds. The focus grows.
- Every board: at least 6 items: a custom lead component, at least one visual beyond numbers (map, timeline, multiples, chart), evidence (stats with sparklines, a table), and 1–3 anchored notes. A board of only a headline, a list and text is a failure.
- Every follow-up changes the board: a question about what's there ("which of these matters?", "why?") gets notes, highlights or a new item on the board, and a short reply. Never answer only in the reply.
- Charts are honest: bars start at zero. When differences are tiny (margins of a few tenths), set options.max to a meaningful scale (e.g. 5 points) or show the numbers in a table instead, so 0.1 doesn't look like a landslide.
- Example numbers below are placeholders: never reuse them. Use real data (search) and label estimates.
`.trim();

const KIT = `
Kit (window.cv in every custom frame; each returns an HTML or SVG string with values escaped):
- cv.render((data, options) => html): draws into <div id="cv-app"> (or the body) and redraws when the item's data changes. cv.width(): the frame's width in px.
- cv.spark(values, {w, h, color}) inline sparkline; cv.bars(values, {w, h}) mini bars; cv.delta(n, {invert, unit}) ▲/▼ chip; cv.fmt(n, {unit, prefix, decimals, signed}); cv.esc(text).
- cv.line(rows, {x, series, w, h, unit, area, highlight, marks: [{x, label}]}): line chart with labels at the line ends and marked moments.
- cv.columns(rows, {x, series, w, h, unit, stacked, highlight}); cv.hbars([{label, value, color, note}], {unit, max, sort}).
- cv.split([{label, value, color}], {total, mark, markLabel}): one bar in parts with a threshold (seats and a majority).
- cv.donut(parts, {size, center, sub}); cv.meter(value, {max, label, marks: [{at, label}]}); cv.waffle([{label, n, color}], {cols}).
- cv.tilemap({PA: 2.1, GA: -0.4} or {PA: {value, label, color}}, {scale: "diverging"|"sequential", legend: [low, high], show: "abbr"|"value"|"label"}): US tile map; names or codes.
- cv.timeline([{date, label, note, tone}], {layout: "column"|"row", highlight}); cv.multiples([{label, values, value, delta, note}], {unit, shared, invert}); cv.legend([{label, color}]).
- Colors: token names ("blue", "red", "good", "bad", "accent", "muted", "c3") or CSS colors.
- Classes: cv-kicker, cv-label, cv-h1, cv-h2, cv-h3, cv-dek, cv-body, cv-small, cv-num, cv-num-sm, cv-unit, cv-delta (cv-up, cv-down), cv-chip, cv-hl (highlighter), cv-rule, cv-grid (auto columns, --cv-col), cv-row, cv-stack, cv-float-right / cv-float-left (text wraps around a figure; --cv-float-w), cv-figure, cv-caption, cv-quote, cv-table (td.n for numbers), cv-legend, cv-swatch.
${TOKEN_HELP}
`.trim();

const LOOK_RULES: Record<OrganicLook, string> = {
  editorial: `
Style: Editorial. ${LOOK_INFO.editorial.line}
- Write like an editor: a sharp headline (a finding, not a topic), a one-sentence dek, then evidence. Kickers are short ("Results · 6 a.m.").
- The lead is a story component: headline, dek, a floated figure (cv-float-right) with body text wrapping around it, inline sparklines in the sentences. Give it importance 5, size xl.
- Sidebars are narrow (size s or m): big serif numbers with a delta and a sparkline, separated by rules; a pull quote (kind quote); a small map or ranked list.
- No boxes, no backgrounds: hierarchy comes from type size, rules (cv-rule) and whitespace. cv-dropcap on the first paragraph of the lead.
`.trim(),
  field: `
Style: Field notes. ${LOOK_INFO.field.line}
- Think out loud at a whiteboard: the focus is the big sketch in the middle, and the evidence is pinned around it on cards and sticky notes.
- Headlines are short and handwritten (the display font is a marker). Use cv-hl to highlight the key words.
- Annotate generously: 2–4 notes with anchor + point, pointing at the exact bar, state or moment that matters ("this flipped!"). Connect cause and effect with relatedTo.
- Cards are small and loose (size s or m); one bigger sketch (a chart or map) as the focus. Notes say one thing in a few words.
`.trim(),
  instrument: `
Style: Instrument. ${LOOK_INFO.instrument.line}
- Maximum information per pixel: compact panels, small multiples instead of one big chart, tabular numbers, mono labels, units everywhere.
- The focus is a wide panel (a map, a timeline or a small-multiples grid); around it, rows of tight readouts (stat, size s) with deltas and sparklines.
- Prefer cv.multiples, cv.tilemap with show: "value", cv.timeline with layout "row", cv-table with td.n, and inline cv.bars.
- Labels are terse and uppercase-friendly ("MARGIN, PTS"). Notes are technical callouts: a value and a reason.
`.trim(),
};

const EXAMPLES: Record<OrganicLook, string> = {
  editorial: ex(`
Example 1, the lead story (kind custom, size xl, importance 5; data: {kicker, title, dek, body, rides: [{month, riders}], weekday: [..]}):
<div id="cv-app"></div>
<script>
cv.render((d) => @@
  <div class="cv-kicker">$[cv.esc(d.kicker)]</div>
  <h1 class="cv-h1" style="margin:6px 0 10px">$[cv.esc(d.title)]</h1>
  <p class="cv-dek">$[cv.esc(d.dek)]</p>
  <hr class="cv-rule">
  <figure class="cv-figure cv-float-right" style="--cv-float-w:48%">
    $[cv.line(d.rides, {x: "month", series: ["riders"], w: Math.round(cv.width() * 0.46), h: 170, unit: "M", marks: [{x: "Mar", label: "fare cut"}]})]
    <figcaption class="cv-caption">Monthly riders, millions</figcaption>
  </figure>
  <div class="cv-body cv-dropcap"><p>$[cv.esc(d.body)] Weekday trips $[cv.spark(d.weekday, {w: 56, h: 14})] kept climbing.</p></div>
@@);
</script>

Example 2, a sidebar of figures (kind custom, size s, importance 4; data: [{label, value, unit, delta, series, note}]):
<div id="cv-app"></div>
<script>
cv.render((rows) => rows.map((r, i) => @@
  $[i ? '<hr class="cv-rule">' : ""]
  <div class="cv-label">$[cv.esc(r.label)]</div>
  <div class="cv-row" style="align-items:flex-end;margin-top:4px">
    <span class="cv-num">$[cv.fmt(r.value)]<span class="cv-unit">$[cv.esc(r.unit || "")]</span></span>
    $[cv.delta(r.delta)] $[cv.spark(r.series, {w: 64, h: 22})]
  </div>
  <div class="cv-small">$[cv.esc(r.note)]</div>
@@).join(""));
</script>

Example 3, built-ins (as canvas_set items):
{"id": "voice", "kind": "quote", "data": {"text": "We rebuilt the schedule around nurses, not tourists.", "by": "Ana Ruiz", "role": "Transit director"}, "size": "m", "importance": 3, "relatedTo": ["lead"]}
{"id": "why-march", "kind": "note", "data": "The fare cut started here", "anchor": "lead", "point": {"x": 0.72, "y": 0.55}}
{"id": "where", "kind": "map", "title": "Change by state, pts", "data": {"PA": 2.1, "GA": -0.6, "AZ": 1.4}, "options": {"scale": "diverging", "legend": ["Fell", "Rose"]}, "size": "m", "importance": 3}
`),
  field: ex(`
Example 1, a ranked sketch card (kind custom, size m, importance 4; data: {title, items: [{label, value, color}], takeaway}):
<div id="cv-app"></div>
<script>
cv.render((d) => @@
  <div class="cv-kicker">ranked, roughly</div>
  <h3 class="cv-h3" style="margin:2px 0 10px">$[cv.esc(d.title)]</h3>
  $[cv.hbars(d.items, {sort: true})]
  <p class="cv-body" style="margin-top:10px">→ <span class="cv-hl">$[cv.esc(d.takeaway)]</span></p>
@@);
</script>

Example 2, the big sketch in the middle (kind custom, size l, importance 5; data: {title, rows: [{day, temp, rain}], peak}):
<div id="cv-app"></div>
<script>
cv.render((d) => @@
  <h2 class="cv-h2">$[cv.esc(d.title)]</h2>
  <div style="margin-top:8px">$[cv.line(d.rows, {x: "day", series: ["temp"], w: cv.width(), h: 190, unit: "°", marks: [{x: d.peak, label: "warmest ✶"}]})]</div>
  <div class="cv-row" style="margin-top:6px">$[d.rows.map((r) => @@<span class="cv-chip">$[cv.esc(r.day)] $[cv.esc(r.rain)]% ☂</span>@@).join("")]</div>
@@);
</script>

Example 3, built-ins pinned around it (as canvas_set items):
{"id": "so-what", "kind": "note", "data": "Saturday is the pick: dry till 4", "anchor": "sketch", "point": {"x": 0.35, "y": 0.4}}
{"id": "heard", "kind": "quote", "data": {"text": "Bring a layer after dark.", "by": "NWS forecaster"}, "size": "s", "importance": 2, "relatedTo": ["sketch"]}
{"id": "sun", "kind": "stat", "title": "UV index", "data": {"value": 6, "series": [3, 4, 6, 5], "caption": "high at noon"}, "size": "s", "importance": 3}
`),
  instrument: ex(`
Example 1, a small-multiples panel (kind custom, size xl, importance 5; data: [{label, values, value, delta, note}]):
<div id="cv-app"></div>
<script>
cv.render((rows) => @@
  <div class="cv-row" style="justify-content:space-between;margin-bottom:8px">
    <span class="cv-kicker">Throughput by region · 24h</span>
    $[cv.legend([{label: "rising", color: "good"}, {label: "falling", color: "bad"}])]
  </div>
  $[cv.multiples(rows, {unit: "k", shared: true, min: 110})]
@@);
</script>

Example 2, a readout strip with a timeline (kind custom, size xl, importance 3; data: {kpis: [{label, value, unit, bars}], events: [{date, label, note, tone}]}):
<div id="cv-app"></div>
<script>
cv.render((d) => @@
  <div class="cv-grid" style="--cv-col:120px;gap:10px">$[d.kpis.map((k) => @@
    <div><div class="cv-label">$[cv.esc(k.label)]</div>
    <div class="cv-num-sm">$[cv.fmt(k.value)]<span class="cv-unit">$[cv.esc(k.unit)]</span></div>
    $[cv.bars(k.bars, {w: 90, h: 16})]</div>@@).join("")]
  </div>
  <div style="margin-top:22px">$[cv.timeline(d.events, {layout: "row", highlight: d.events.length - 1})]</div>
@@);
</script>

Example 3, built-ins (as canvas_set items):
{"id": "by-state", "kind": "map", "title": "Margin by state, pts", "data": {"PA": 2.1, "GA": -0.6}, "options": {"scale": "diverging", "show": "value", "legend": ["−", "+"]}, "size": "l", "importance": 4}
{"id": "events", "kind": "timeline", "data": [{"date": "06:10", "label": "Feed lag", "tone": "bad"}], "options": {"layout": "row"}, "size": "xl", "importance": 2}
{"id": "lag-note", "kind": "note", "data": "p95 320 ms: cache miss storm", "anchor": "by-state", "point": {"x": 0.8, "y": 0.3}}
`),
};

const CHOOSING = `
CHOOSING THE STYLE. You pick the board's style, per board, from what the content is; the user never has to.
- editorial: news, results, events, stories, explainers ("what happened", "how did X go"). A lead story with the evidence around it.
- field: brainstorming, planning, trips, ideas, decisions with options ("help me plan / think through / decide"). Cards and stickies around a central sketch.
- instrument: dense data, monitoring, metrics, many numbers to compare ("how is X doing right now", a table of figures). Tight panels and small multiples.
- If the user names one, use it: "make this a whiteboard" is field, "like a newspaper" is editorial, "as a dashboard" is instrument.
- Set it with style (and styleReason, a few words) on your first canvas_set. Keep it for follow-ups on the same topic. When the topic changes kind, switch in the same canvas_set (or canvas_style alone): the switch animates.
- Borrow accents across styles when one helps: a note takes options.accent sticky, margin or callout; a quote takes pull, sticky or bar. In HTML, the classes cv-sticky, cv-margin-note and cv-callout work in every style.
Examples:
- "How did yesterday's election go?" → editorial: it's news; lead with the result and put the evidence around it.
- "Help me plan a weekend in Vermont with the kids" → field: it's planning; days, options and constraints as cards, decisions as stickies.
- "Here are our API's latency and error numbers for the last day" → instrument: dense metrics; readouts, small multiples, a timeline of incidents.
- "Should I take the Denver job or stay?" → field: a decision with trade-offs (instrument only if it's mostly numbers).
- Borrowing: "which of these should I worry about?" on an instrument board of server metrics: keep the style, and mark the one to fix with a sticky, which stands out among the callouts: {"kind": "note", "data": "Fix this first", "anchor": "p95", "point": {"x": 0.9, "y": 0.3}, "options": {"accent": "sticky"}}. A sticky on a dashboard draws the eye.
- Switching: after an editorial election board, "Help me plan my week around the recount hearings" is planning: canvas_set({"style": "field", "styleReason": "planning a week", "items": [...]}).
`.trim();

const ACCENTS = `
Borrowed accents (any style): note options.accent "sticky" (a taped sticky note, hand-written), "margin" (an italic margin note on a rule), "callout" (a dashed technical callout); quote options.accent "pull" (big italic pull quote), "sticky" (a pink sticky), "bar" (a quote with an accent bar). Each style's own is the default. In HTML: <div class="cv-sticky">…</div>, <aside class="cv-margin-note">…</aside>, <div class="cv-callout">…</div>.
`.trim();

const NAMES: Record<OrganicLook, string> = { editorial: "Editorial", field: "Field notes", instrument: "Instrument" };
const STYLES: readonly OrganicLook[] = ["editorial", "field", "instrument"];

/** The guide: how to choose, the shared rules, the kit, accents, and each style's rules and examples (or one style's). */
export function designGuide(only: OrganicLook | null = null): string {
  const styles = only ? [only] : STYLES;
  return [
    "DESIGN GUIDE",
    CHOOSING,
    COMMON,
    KIT,
    ACCENTS,
    ...styles.map((look) => `STYLE ${look} (${NAMES[look]})\n${LOOK_RULES[look]}\n\nExamples to adapt (change the content; keep the craft):\n${EXAMPLES[look]}`),
  ].join("\n\n");
}

/** The configure hook's line about styles: the current one and how to choose. */
export function lookInstruction(look: OrganicLook): string {
  return `Board style (you choose it): editorial for news and stories, field for brainstorming and planning, instrument for dense data and monitoring; a style the user names wins. Set style (with styleReason) on your first canvas_set, keep it for follow-ups, switch on a topic change of a different kind (canvas_set with style, or canvas_style). Borrow accents across styles with options.accent on notes and quotes. This board is ${look} (${LOOK_INFO[look].name}) now. Make every board rich and dense, not a slide: at least 6 items: (1) a lead you write as a custom HTML component with the tokens and the kit (window.cv); (2) a visual beyond numbers (map, timeline, small multiples, chart); (3) stats with sparklines or a table for the evidence; (4) 1–3 notes with anchor + point on what matters. Every follow-up changes the board (add, update, annotate, highlight); never answer only in the reply. To single out what matters most on a dense board, borrow a sticky (note options.accent "sticky"). The design guide with examples is in this thread's first message; canvas_guide returns it.`;
}
