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
Compose the board like a designer laying out a front page or a poster for this exact question. Not a slide, not a grid, not a list of cards.
- ONE HERO dominates: scale "hero" (importance 5). Often a big custom piece: a chart annotated on itself, a number set huge, a map, a timeline across the screen, a quote with no frame. The hero is the answer, not a title.
- Everything else at CLEARLY DIFFERENT scales: one or two "large", a few "medium", the rest "small" or "tiny". Never several items of the same size in a row. 5–10 items in all; fewer, denser pieces beat many sparse ones.
- Place things roughly; Studio composes them to fill the screen (no grid, no columns, no reading order): region ("top-right", "bottom-left", …) for where, pinnedTo (an id) with point ({x, y} 0–1 on it) and side for "right next to that spot" (nothing is drawn between them), bleed for a hero that runs off the edge. Leave out what you don't care about: the composition fills it in.
- GO VISUAL when the ask is about things you can see: "showcase", "show me", products, games, albums, places, people, food. Imagery first: find real pictures (covers, box art, product shots, photos) by web search and use image items with their http(s) URLs (custom frames have no network, so pictures never go inside them). Ratings are drawn, not typed: stars (image options.rating, or cv.stars), a big numeral, or bars, never a column of numbers in a table. Use the gallery composition.
- No boxes. Text and charts sit directly on the board; there are no cards or backgrounds to rely on. Hierarchy comes from scale, type and whitespace.
- Shaped pieces, not rectangles: labels drawn on the chart itself (callouts: […] on cv.line, cv.columns and cv.tilemap; options.callouts on line, bar and area items), a number in huge type (cv.bignum, or a stat as the hero), a quote with no frame (cv.quote, or a quote item), a callout with a leader line inside your own figure (cv.callout).
- Say what matters inside the pieces themselves: a callout on the chart at the moment it turned, a takeaway line in a custom component, a cv-hl highlight, a stat's caption, or a short caption item. There are no notes, stickies or connectors between items.
- Do NOT use the old template: kicker, then big headline, then dek, then a drop-cap paragraph, then a full-width table. A headline item is optional; when there is one, it's medium or small, never the hero unless the words are the whole answer.
- Generated components come first: kind "custom" with html, in a sandboxed frame that has this style's tokens (CSS variables), the kit classes and window.cv. The frame grows to its content's height: never set a height on your outer element. Size figures to cv.width() and cv.height() (the room its place in the composition gives it). No network: no external images, fonts or scripts. options.visual: true marks a custom chart or map, so labels may sit on it.
- Put the numbers in the item's data and draw them with cv.render((data, options) => html), so canvas_update changes data and the user sees it change in place.
- Built-ins when they fit: headline, stat (series → sparkline; as the hero it's set huge), quote, caption, map, timeline, multiples, line, bar, area, pie, table, list, image (options: headline, kicker, caption, rating, ratingMax, aspect "3 / 4" for covers and box art, fit "contain" to show all of it, focus for what stays when cropped; a failed address shows its name on a tile).
- Inline marks in captions: {spark:3,5,4,8}, {delta:+2.1}, ==highlight==. In HTML: cv.spark, cv.delta.
- Charts are honest: bars start at zero. When differences are tiny (margins of a few tenths), set options.max to a meaningful scale (e.g. 5 points) or show numbers instead, so 0.1 doesn't look like a landslide.
- Every follow-up changes the board: a question about what's there gets callouts, highlights, a takeaway, a new piece or a recomposition, and a short reply. Never answer only in the reply.
- title (canvas_set, canvas_clear): the topic in a few words; set it whenever the topic changes. Your reply (the caption under the board) adds what the board doesn't say: what to look at first, what it means for the user, or what's next. One or two spoken sentences. Never restate the board.
- Example numbers below are placeholders: never reuse them. Use real data (search) and label samples and estimates.
`.trim();

const COMPOSITIONS_GUIDE = `
COMPOSITIONS. Pick one per board from the content, and set it (canvas_set composition). Never use the same composition on two boards in a row unless the user asks for it (the tool refuses; sameComposition: true only when they asked). A follow-up on the same board can keep it, or recompose with a new one.
- orbit: a hero chart or figure (center-left or center-right); facts orbit it at different scales, a callout on its key moment. For a trend, a result, a comparison over time.
- giant-number: one number set huge (a stat or cv.bignum as the hero); two or three small facts pinned beside it; a small supporting chart and a line of context. For "how many / how much / did it pass".
- map: the map in the middle (hero); facts in the corners (regions), callouts on the places that matter (cv.tilemap callouts or the map's options.callouts). For anything where "where" is the story.
- spine: a timeline running across the screen (hero, scale hero, it spans the width); moments, quotes and numbers above and below it, pinned to their dates. For plans, histories, schedules, sequences.
- split: two heroes side by side (both scale hero), each with its evidence under it; the verdict or the trade-off between them at the top or bottom. For "A or B", before/after, us vs them.
- quote: a big quote with no frame leads (hero); the evidence beside and below it. For a story with a voice, a decision someone made.
- close-up: one chart full width (hero, bleed: true), annotated on itself with callouts; three or four small facts under it. For one series that tells the story.
- essay: a column of text on one side (a caption or custom text as the hero), the figures around it on the other. For explainers and overviews where the words carry it.
- gallery: pictures first: one big image (hero) and four to eight smaller ones at different sizes, each an image item with its name (options.headline), a rating as stars (options.rating, ratingMax) and a one-line caption. For "showcase", "show me", products, games, places, people, food, anything you'd want to see.
Choosing: what is the ONE thing the user should see? Make that the hero, then pick the composition that shows it best. Two boards about different things should look different.
`.trim();
const KIT = `
Kit (window.cv in every custom frame; each returns an HTML or SVG string with values escaped):
- cv.render((data, options) => html): draws into <div id="cv-app"> (or the body) and redraws when the item's data changes. cv.width(), cv.height(): the room this piece has, in px.
- Shaped pieces: cv.bignum(value, {label, unit, prefix, delta, sub, size, color}) a number in huge type; cv.quote(text, {by, role, size}) a quote with no frame; cv.callout(text, {x, y, dx, dy, color, w}) a label with a leader line to the spot (x, y: 0–1) on your figure: wrap the figure and its callouts in <div class="cv-annotated">.
- cv.stars(score, {max: 5|10|100, size, color, label}): a rating as stars with the number.
- Charts: cv.line(rows, {x, series, w, h, unit, area, highlight, marks: [{x, label}], callouts: [{x, series?, text, dx?, dy?}]}) (callouts are labels drawn on the chart, at that point); cv.columns(rows, {x, series, w, h, unit, stacked, highlight, max, callouts: [{x, text}]}); cv.hbars([{label, value, color, note}], {unit, max, sort}); cv.split([{label, value, color}], {total, mark, markLabel}); cv.donut(parts, {size, center, sub}); cv.meter(value, {max, label, marks}); cv.waffle([{label, n, color}], {cols}).
- cv.tilemap({PA: 2.1} or {PA: {value, label, color}}, {scale: "diverging"|"sequential", legend: [low, high], show: "abbr"|"value"|"label", callouts: [{state, text, side?}]}): US tile map; callouts sit beside the map with a leader to the state.
- cv.timeline([{date, label, note, tone}], {layout: "column"|"row", highlight}); cv.multiples([{label, values, value, delta, note}], {unit, shared, invert}); cv.spark(values, {w, h, color}); cv.bars(values, {w, h}); cv.delta(n, {invert, unit}); cv.fmt(n, {unit, prefix, decimals, signed}); cv.legend([{label, color}]); cv.esc(text).
- Colors: token names ("blue", "red", "good", "bad", "accent", "muted", "c3") or CSS colors.
- Classes: cv-kicker, cv-label, cv-h1, cv-h2, cv-h3, cv-dek, cv-body, cv-small, cv-num, cv-unit, cv-delta, cv-chip, cv-hl (highlighter), cv-rule, cv-row, cv-stack, cv-grid, cv-float-right / cv-float-left, cv-figure, cv-caption, cv-table (td.n for numbers), cv-legend, cv-annotated.
${TOKEN_HELP}
`.trim();

const LOOK_RULES: Record<OrganicLook, string> = {
  editorial: `
Style: Editorial. ${LOOK_INFO.editorial.line}
- Write like an editor: a finding, not a topic. Short kickers ("Results · 6 a.m."); words that say what changed.
- Heroes: a chart annotated on itself, a giant serif number, a frameless pull quote, a map with its places called out. Around it: big serif numbers with a delta, a ranked list, a short paragraph, a caption pinned beside what it explains.
- Type and whitespace carry the hierarchy; a hairline rule only where two pieces need separating. Vary it board to board: giant-number for a vote, orbit for a trend, quote for a profile, map for a national story, essay for an explainer.
`.trim(),
  field: `
Style: Field notes. ${LOOK_INFO.field.line}
- Think out loud at a whiteboard: one big sketch (a timeline across the board, a split of two options, a map of the trip), with arrows (→) and highlights drawn into it at exactly what matters ("this one!").
- Headlines are short and handwritten (the display font is a marker); cv-hl highlights key words. Small hand-written facts (stat, caption) sit loose around the sketch, each saying one thing in a few words.
- Plans are a spine, decisions a split, places a map. Pieces are loose and at different sizes; a little tilt is fine, rows of equal cards are not.
`.trim(),
  instrument: `
Style: Instrument. ${LOOK_INFO.instrument.line}
- Maximum information per pixel, but still one hero: the series that matters full width (close-up, bleed), a small-multiples panel, or one status number huge. Around it: tight readouts (stat, small or tiny) with units, deltas and sparklines.
- Prefer cv.multiples, cv.tilemap with show: "value", cv.timeline with layout "row", cv-table with td.n, inline cv.bars. Label the hero chart itself (callouts) at the incident, the threshold, the peak.
- Labels are terse and uppercase-friendly ("P95, MS"). Put the reason next to the value: a stat's caption, or a callout on the chart.
`.trim(),
};

const EXAMPLES: Record<OrganicLook, string> = {
  editorial: ex(`
Example 1, giant-number (a vote result), as one canvas_set:
{"composition": "giant-number", "title": "Transit levy passes", "items": [
 {"id": "yes", "kind": "stat", "scale": "hero", "importance": 5, "title": "Yes on Measure 4", "data": {"value": 58.4, "delta": "+6.1", "caption": "Passes in 9 of 10 districts"}, "options": {"unit": "%"}},
 {"id": "why", "kind": "caption", "scale": "tiny", "pinnedTo": "yes", "point": {"x": 1, "y": 0.4}, "side": "right", "data": "Widest transit-tax margin since 1998."},
 {"id": "districts", "kind": "bar", "scale": "medium", "region": "right", "title": "Yes by district, %", "data": [{"district": "D1", "yes": 64}, {"district": "D4", "yes": 47}], "options": {"max": 100, "callouts": [{"x": "D4", "text": "the only no"}]}},
 {"id": "voice", "kind": "quote", "scale": "medium", "region": "bottom-left", "data": {"text": "We rebuilt the schedule around nurses, not tourists.", "by": "Ana Ruiz", "role": "Transit director"}},
 {"id": "next", "kind": "caption", "scale": "small", "region": "bottom-right", "data": "Bonds go to the council in March; fares stay frozen through 2028."}]}

Example 2, orbit: a hero chart annotated on itself (kind custom, scale hero, options {"visual": true}; data: {title, rows: [{month, riders}], callouts: [{x, text}]}):
<div id="cv-app"></div>
<script>
cv.render((d) => @@
  <div class="cv-kicker">$[cv.esc(d.kicker)]</div>
  <h2 class="cv-h2" style="margin:4px 0 12px;max-width:22ch">$[cv.esc(d.title)]</h2>
  $[cv.line(d.rows, {x: "month", series: ["riders"], w: cv.width(), h: cv.height() - 80, unit: "M", callouts: d.callouts})]
@@);
</script>
Around it: two stats (scale small, regions top-right and right), a short caption (scale small, bottom-left).

Example 3, quote-led (as canvas_set items):
{"id": "lead-quote", "kind": "quote", "scale": "hero", "importance": 5, "data": {"text": "Nobody planned for the river to do that twice.", "by": "Mayor Lin"}}
{"id": "levels", "kind": "line", "scale": "large", "region": "bottom-right", "title": "River level, ft", "data": [{"day": "Mon", "ft": 12}], "options": {"callouts": [{"x": "Thu", "text": "crest, 1 ft over the wall"}]}}
{"id": "homes", "kind": "stat", "scale": "small", "region": "top-right", "title": "Homes flooded", "data": {"value": 1240, "caption": "county estimate"}}
`),
  field: ex(`
Example 1, spine (a plan), as one canvas_set:
{"composition": "spine", "title": "Hudson Valley weekend", "items": [
 {"id": "days", "kind": "timeline", "scale": "hero", "importance": 5, "data": [{"date": "Fri 6pm", "label": "Drive up"}, {"date": "Sat am", "label": "Apple picking", "tone": "good"}, {"date": "Sun", "label": "Walkway over the Hudson"}], "options": {"layout": "row"}},
 {"id": "rain", "kind": "caption", "scale": "small", "pinnedTo": "days", "point": {"x": 0.62, "y": 0}, "side": "above", "data": "Rain Sat pm → ==museum backup=="},
 {"id": "budget", "kind": "stat", "scale": "small", "region": "top-left", "title": "Budget", "data": {"value": 640, "caption": "lodging is half"}, "options": {"prefix": "$"}},
 {"id": "drive", "kind": "stat", "scale": "tiny", "region": "bottom-right", "title": "Drive", "data": {"value": "2h 10m"}},
 {"id": "pick", "kind": "list", "scale": "medium", "region": "bottom-left", "title": "Orchards, ranked", "data": ["Fishkill Farms", "Wilklow Orchards"]}]}

Example 2, split (a decision): two heroes, each a custom sketch (scale hero) with its pros and cons, the verdict in big hand-written type at the top:
<div id="cv-app"></div>
<script>
cv.render((d) => @@
  <h2 class="cv-h2"><span class="cv-hl">$[cv.esc(d.option)]</span></h2>
  <div class="cv-annotated" style="margin-top:10px">
    $[cv.columns(d.costs, {x: "year", series: ["cost"], w: cv.width(), h: Math.min(260, cv.height() - 120), unit: "k"})]
    $[cv.callout(d.callout.text, {x: d.callout.x, y: d.callout.y, dx: -70, dy: -40})]
  </div>
  <p class="cv-body">→ $[cv.esc(d.takeaway)]</p>
@@);
</script>
{"id": "verdict", "kind": "headline", "scale": "medium", "region": "top", "data": {"text": "Denver wins if the move is paid"}}

Example 3, map-centred (a trip): {"composition": "map"}, the map as the hero with callouts: [{state, text}] in its options, small facts in the corners (regions), the drive time as a giant number (scale small, region bottom-right).
`),
  instrument: ex(`
Example 1, close-up: one series full width, annotated on itself, as canvas_set items:
{"id": "p95", "kind": "area", "scale": "hero", "importance": 5, "bleed": true, "title": "P95 LATENCY, MS · 24H", "data": [{"hour": "06", "ms": 420}, {"hour": "08", "ms": 880}], "options": {"unit": "ms", "callouts": [{"x": "08", "text": "cache miss storm"}]}}
{"id": "err", "kind": "stat", "scale": "small", "region": "bottom-left", "title": "ERRORS / MIN", "data": {"value": 6.1, "series": [0.4, 0.9, 1.8, 3.6, 6.1], "delta": "+4.3"}, "options": {"invert": true}}
{"id": "agents", "kind": "stat", "scale": "tiny", "region": "bottom", "title": "ACTIVE AGENTS", "data": {"value": 17}}
{"id": "fix", "kind": "caption", "scale": "small", "region": "top-right", "data": "Fix the ==cache warmer== first: it explains the 08:00 spike."}

Example 2, orbit around small multiples (kind custom, scale hero; data: [{label, values, value, delta, note}]):
<div id="cv-app"></div>
<script>
cv.render((rows) => @@
  <div class="cv-row" style="justify-content:space-between;margin-bottom:8px">
    <span class="cv-kicker">Throughput by region · 24h</span>
    $[cv.legend([{label: "rising", color: "good"}, {label: "falling", color: "bad"}])]
  </div>
  $[cv.multiples(rows, {unit: "k", shared: true, min: 120})]
@@);
</script>

Example 3, giant-number status (kind custom, scale hero; data: {value, label, sub, delta}):
<div id="cv-app"></div>
<script>
cv.render((d) => cv.bignum(d.value, {label: d.label, unit: "%", delta: d.delta, sub: d.sub, color: d.value < 99.9 ? "bad" : "good"}));
</script>
`),
};

const CHOOSING = `
CHOOSING THE STYLE. You pick the board's style, per board, from what the content is; the user never has to.
- editorial: news, results, events, stories, explainers ("what happened", "how did X go"). A lead story with the evidence around it.
- field: brainstorming, planning, trips, ideas, decisions with options ("help me plan / think through / decide"). Cards around a central sketch.
- instrument: dense data, monitoring, metrics, many numbers to compare ("how is X doing right now", a table of figures). Tight panels and small multiples.
- If the user names one, use it: "make this a whiteboard" is field, "like a newspaper" is editorial, "as a dashboard" is instrument.
- Set it with style (and styleReason, a few words) on your first canvas_set. Keep it for follow-ups on the same topic. When the topic changes kind, switch in the same canvas_set (or canvas_style alone): the switch animates.
- A quote can take options.accent pull or bar in any style.
Examples:
- "How did yesterday's election go?" → editorial: it's news; lead with the result and put the evidence around it.
- "Help me plan a weekend in Vermont with the kids" → field: it's planning; days, options and constraints as cards, the decision highlighted on the lead.
- "Here are our API's latency and error numbers for the last day" → instrument: dense metrics; readouts, small multiples, a timeline of incidents.
- "Should I take the Denver job or stay?" → field: a decision with trade-offs (instrument only if it's mostly numbers).
- Singling out: "which of these should I worry about?" on an instrument board of server metrics: keep the style, raise the one to fix to importance 5 so it becomes the focus, and say why in its caption: canvas_update({"items": [{"id": "p95", "importance": 5, "data": {"value": 320, "series": [180, 190, 240, 320], "caption": "Fix this first: cache miss storm"}}]}).
- Switching: after an editorial election board, "Help me plan my week around the recount hearings" is planning: canvas_set({"style": "field", "styleReason": "planning a week", "items": [...]}).
`.trim();

const ACCENTS = `
Quote accents (any style): options.accent "pull" (a big italic pull quote) or "bar" (a quote with an accent bar). Each style's own is the default.
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
    COMPOSITIONS_GUIDE,
    KIT,
    ACCENTS,
    ...styles.map((look) => `STYLE ${look} (${NAMES[look]})\n${LOOK_RULES[look]}\n\nExamples to adapt (change the content; keep the craft):\n${EXAMPLES[look]}`),
  ].join("\n\n");
}

/** The configure hook's line about styles: the current one and how to choose. */
export function lookInstruction(look: OrganicLook): string {
  return `Board style (you choose it): editorial for news and stories, field for brainstorming and planning, instrument for dense data and monitoring; a style the user names wins. Set style (with styleReason) on your first canvas_set, keep it for follow-ups, switch on a topic change of a different kind. This board is ${look} (${LOOK_INFO[look].name}) now. Compose every board for its content: pick a composition (orbit, giant-number, map, spine, split, quote, close-up, essay; never the same as the last board unless asked) and set it with canvas_set composition, with a title naming the topic. One hero (scale "hero"): often your own custom piece, a chart annotated on itself, a huge number, a map, a timeline across the screen, a frameless quote. The rest at clearly different scales (large, medium, small, tiny), placed roughly with region or pinnedTo + point; Studio fills the screen, no grid. No boxes, no notes or connectors: say what matters inside the pieces (callouts on charts, takeaways, highlights). Never the kicker-headline-dek-paragraph-table template. Every follow-up changes the board. The design guide with examples is in this thread's first message; canvas_guide returns it.`;
}
