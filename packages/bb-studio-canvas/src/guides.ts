// The design guide a canvas agent works from: how to tell one story on one
// page, what the page's frame gives it (tokens, kit, charts, pictures), the
// styles in a line each, the honesty rules, and four examples. Short on
// purpose: method and examples, not a rulebook. The first message carries
// it (agent only), and canvas_guide returns it again.
import { LOOK_INFO, ORGANIC_LOOKS, TOKEN_HELP } from "./looks";

const METHOD = `
DESIGN GUIDE

You design each board as one page, like an editor laying out a spread for this exact question.
1. Decide the ONE point: what should the user see first and remember?
2. Pick the shape that tells it. Let the content decide: a plan or a history runs along a timeline; a showcase is a wall of pictures, each with its name and rating; two options sit side by side with the verdict over them; one key figure is set huge with its evidence beside it; a place is a map with what happened where. Don't reuse last turn's shape for different content.
3. Give it a reading path: one entry point (the biggest thing), then an obvious order. Line things up on a few strong edges; group what belongs together; keep margins consistent. Use type size, weight and space for hierarchy, not boxes.
4. Cut everything that doesn't serve the point. Fewer, stronger parts.
5. Fill the screen. The page is the whole screen, not a document at the top of it: no empty bottom third, no empty right side. When the content is short, make it bigger (type, figures, pictures, charts), not sparser.
`.trim();

const FILL = `
FILL THE SCREEN (firm):
- Start every page with a full-screen layout: <div class="cv-fill"> (a grid: header row, a middle row that takes all the remaining height, footer row) or your own grid with min-height: calc(100vh - 60px) and a 1fr row. Put the main content in the 1fr row and let it stretch: charts get height: 100% (or a vh height), pictures fill their cell (object-fit: cover), columns span the full width.
- Size type from the screen: the --cv-t-* sizes already grow with it in a page; use --cv-f-hero for one huge figure, and vh or clamp() for anything bigger. Never leave a column of small text in one corner.
- Use the full width: columns run edge to edge (grid-template-columns that add up to the whole width), not a fixed max-width block.
- cv.viewport() gives the screen's width and height in px (also --cv-vw and --cv-vh). As a safety net, a page that stops short is zoomed up a little, but design it to fill.
`.trim();

const PAGE = `
THE PAGE (canvas_page html):
- HTML and CSS for the board's body (no <html>/<head>). It fills a frame the size of the screen: 100vw × 100vh is what the user sees, and it scrolls if taller. Design for that: CSS grid or flex, min-height: calc(100vh - 60px) for a page that fills the screen, clamp() for type that scales.
- Put a <style> at the top for your layout. Colours, type and spacing come from the style's tokens (var(--cv-…)), so a style switch restyles your page.
- Mark the main parts with data-cv-id="…" (short, stable, named after what they show: "verdict", "chat", "game-tetris"). In a follow-up, anything that's still on the board keeps its id, even when it moves, grows or changes style: canvas_read lists the current ids. Same id → it glides to its new place; a new id → it enters as new. canvas_patch replaces one part by id.
- Charts without drawing SVG: <div data-chart="KIND" data-rows='[…]' data-options='{…}'></div> (data-value for one number), sized to the element's width (give it a CSS height for line, area and columns). KIND: line, area, columns (vertical bars), bars (horizontal, ranked), donut, split (one bar in parts with a mark), map (US tile map: rows {"PA": 2.1} or [{state, value}]), timeline ([{date, label, note, tone}], options {layout: "row"}), multiples, waffle, spark, stars (data-value score, options {max: 5|10|100}), meter, bignum (data-value, options {label, unit, sub}), delta, legend. Options as in the kit: x, series, unit, max, highlight, marks [{x, label}], callouts [{x, text}] (labels drawn on the chart at that point).
- Pictures: canvas_image gives an https address (query, or pageUrl of a page about the thing); use it in <img src alt>. Nothing else loads from the network: no fonts, scripts or fetches.
- Scripts run (window.cv is the kit: cv.esc, cv.fmt, cv.line(rows, opts) and the rest return HTML strings), but declarative charts are simpler and animate better.
- Kit classes when they help: cv-kicker, cv-label, cv-h1, cv-h2, cv-h3, cv-dek, cv-body, cv-small, cv-num, cv-unit, cv-hl (highlighter), cv-rule, cv-table (td.n for numbers), cv-legend, cv-chip.
${TOKEN_HELP}
`.trim();

const STYLES = `
STYLES (token sets; you pick, and the user can name one):
${ORGANIC_LOOKS.map((look) => `- ${look}: ${LOOK_INFO[look].name}. ${LOOK_INFO[look].line}`).join("\n")}
`.trim();

const HONEST = `
HONEST AND VISUAL:
- Bars and areas start at zero; axes and units are labelled. Tiny differences get a meaningful scale (options.max) or numbers instead.
- Real data when you can get it (search). Sample, estimated or partial data says so on the board; sources are named on it (small, at the foot of the part they support).
- A showcase, "show me", products, games, places, people: pictures first. Call canvas_image for each thing (a picture that fails to load shows nothing, so give every <img> an alt and a name under it). Ratings are drawn: stars, a big numeral or bars, never a column of numbers.
- Every rating or score says where it came from, on the board, next to it: the outlet ("IGN 9/10") when it's published, or "my pick" / "editor's picks, not review scores" when it's yours. data-chart="stars" takes options {source: "IGN"}; without one it labels itself "my pick" (options.note changes the words).
- The caption (your reply) says what the board doesn't: the takeaway, a caveat, or a next step. It never describes the board: no "the board shows", "on the board", "I've laid out", "here's". Start with the point.
`.trim();

const EXAMPLES = `
EXAMPLES (adapt the shape to your content; never reuse the numbers):

1. A plan along a timeline (field):
<style>
.wk{display:grid;grid-template-rows:auto 1fr auto;gap:28px;min-height:calc(100vh - 60px)}  /* the days row takes the rest of the screen */
.wk h1{font:var(--cv-display-weight) var(--cv-t-3xl)/1.05 var(--cv-font-display);margin:0}
.wk .days{display:grid;grid-template-columns:repeat(7,1fr);border-top:3px solid var(--cv-ink)}
.wk .day .cv-h3{font-size:var(--cv-t-2xl)}
.wk .day{padding:14px 12px 0;border-left:1px solid var(--cv-rule)}
.wk .day.key{background:color-mix(in oklab,var(--cv-accent) 12%,transparent)}
.wk .foot{display:grid;grid-template-columns:2fr 1fr;gap:40px}
</style>
<div class="wk">
  <header data-cv-id="title"><div class="cv-kicker">Next week</div><h1>Launch Thursday; everything else <span class="cv-hl">around it</span></h1></header>
  <section class="days" data-cv-id="days">
    <div class="day" data-cv-id="mon"><div class="cv-label">Mon 9</div><div class="cv-h3">Gym</div><p class="cv-small">Dentist 4pm</p></div>
    <div class="day key" data-cv-id="thu"><div class="cv-label">Thu 12</div><div class="cv-h3">Launch</div><p class="cv-small">Nothing else</p></div>
  </section>
  <footer class="foot"><p class="cv-dek" data-cv-id="why">Interviews sit Tuesday and Friday so launch day stays clear.</p><div data-cv-id="gym" data-chart="bignum" data-value="3" data-options='{"label":"Gym sessions","sub":"Mon, Wed, Sat"}'></div></footer>
</div>

2. A showcase as a wall of pictures with drawn ratings (editorial; each src from canvas_image):
<style>
.wall{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;grid-template-rows:auto 1fr 1fr;gap:22px;min-height:calc(100vh - 60px)}
.wall h1{grid-column:2/-1;margin:0;font:var(--cv-display-weight) var(--cv-t-3xl)/1 var(--cv-font-display)}
.wall .lead{grid-row:1/-1}
.wall figure{margin:0;display:flex;flex-direction:column;gap:6px}
.wall img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:var(--cv-radius-sm);background:var(--cv-rule)}
.wall .lead img{aspect-ratio:auto;flex:1;min-height:0}
</style>
<div class="wall">  <!-- inside a cv-fill page; the two rows of pictures take the remaining height -->
  <figure class="lead" data-cv-id="game-links"><img src="https://…/links-awakening.jpg" alt="Link's Awakening box art"><div class="cv-h2">Link's Awakening</div><div data-chart="stars" data-value="9.5" data-options='{"max":10,"source":"IGN"}'></div><p class="cv-small">Start here: the best game on the system.</p></figure>
  <h1 data-cv-id="title">Six cartridges worth owning first</h1>
  <figure data-cv-id="game-tetris"><img src="https://…/tetris.jpg" alt="Tetris box art"><div class="cv-h3">Tetris</div><div data-chart="stars" data-value="9" data-options='{"max":10}'></div></figure>  <!-- no published score: it reads "my pick" -->
  …five more figures…
</div>

3. One key figure with its evidence (instrument):
<style>
.kf{display:grid;grid-template-columns:1fr 1.6fr;gap:48px;align-items:center;min-height:calc(100vh - 60px)}
.kf .n{font:var(--cv-display-weight) clamp(120px,18vw,260px)/.85 var(--cv-font-num);letter-spacing:-.04em}
.kf .chart{height:52vh}
</style>
<div class="kf">
  <div data-cv-id="figure"><div class="cv-label">Median first reply, minutes</div><div class="n">88</div><p class="cv-dek">Double W32. It passed an hour in W36, when in-app volume took off.</p></div>
  <div data-cv-id="trend"><div class="cv-label">By week · sample data</div><div class="chart" data-chart="line" data-rows='[{"week":"W32","min":42},{"week":"W39","min":88}]' data-options='{"x":"week","unit":" min","callouts":[{"x":"W36","text":"passes 1 hour"}]}'></div></div>
</div>

4. Two options side by side (editorial):
<style>
.vs{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto 1fr auto;column-gap:56px;row-gap:24px;min-height:calc(100vh - 60px)}
.vs h1{grid-column:1/-1;margin:0;font:var(--cv-display-weight) var(--cv-t-3xl)/1.05 var(--cv-font-display)}
.vs .side{border-top:3px solid var(--cv-ink);padding-top:14px}
</style>
<div class="vs">
  <h1 data-cv-id="verdict">Fix chat first; contain in-app next</h1>
  <section class="side" data-cv-id="chat"><div class="cv-label">Chat</div><div data-chart="bignum" data-value="1010" data-options='{"unit":" /wk","sub":"Largest queue: 48% of tickets"}'></div></section>
  <section class="side" data-cv-id="inapp"><div class="cv-label">In-app</div><div data-chart="bignum" data-value="470" data-options='{"unit":" /wk","sub":"Fastest growing: 5×"}'></div></section>
  <p class="cv-small" data-cv-id="source">Sample data, W32–W39.</p>
</div>
`.trim();

/** The guide: the method, the page, the styles, honesty, and the examples. */
export function designGuide(): string {
  return [METHOD, FILL, PAGE, STYLES, HONEST, EXAMPLES].join("\n\n");
}
