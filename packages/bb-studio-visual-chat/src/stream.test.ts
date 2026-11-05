import { describe, expect, it } from "vitest";
import { extractPage, PageStream, repairPartial, turnPage, TurnText, type EventRow, type StreamUpdate } from "./stream";

const PAGE = `<style>.w{display:grid;grid-template-columns:1fr 1fr}.h{color:red}</style>
<div class="cv-fill">
  <header data-cv-id="title"><h1 class="cv-h1">Five Chromatic games &amp; why</h1></header>
  <div class="cv-wall w" data-cv-id="games">
    <div data-block="card" data-cv-id="game-tetris" data-title="Tetris DX" data-rating="9"></div>
    <div data-block="card" data-cv-id="game-links" data-title="Link's Awakening DX"></div>
  </div>
  <p class="cv-small" data-cv-id="source">Scores: my picks.</p>
</div>`;

const REPLY = `\`\`\`html\n${PAGE}\n\`\`\`\nStart with Link's Awakening: it's the one everyone finishes.`;

describe("the fence", () => {
  it("finds the html block, its caption after it, and the style and title on the fence line", () => {
    const found = extractPage(`\`\`\`html style=field title="Chromatic games"\n${PAGE}\n\`\`\`\n\nStart with Link's Awakening.`);
    expect(found).toMatchObject({ opened: true, closed: true, html: PAGE, caption: "Start with Link's Awakening.", style: "field", title: "Chromatic games" });
  });

  it("isn't open until the fence line is complete, and an unknown style is ignored", () => {
    expect(extractPage("Here we go.\n```htm").opened).toBe(false);
    expect(extractPage("```html").opened).toBe(false);
    expect(extractPage("```html style=neon\n<p>x</p>")).toMatchObject({ opened: true, closed: false, style: null });
  });

  it("takes what's there of a growing block, without a half-written closing fence", () => {
    expect(extractPage("```html\n<div>a</div>\n``")).toMatchObject({ closed: false, html: "<div>a</div>\n" });
    expect(extractPage("```html\n<div>a</div>\n```")).toMatchObject({ closed: true, html: "<div>a</div>" });
  });

  it("uses the last html block, and the words before it when nothing follows", () => {
    const found = extractPage("The draft was wrong.\n```html\n<p>one</p>\n```\nThen:\n```html\n<p>two</p>\n```");
    expect(found.html).toBe("<p>two</p>");
    expect(found.caption).toContain("Then:");
    expect(extractPage("No page this time.")).toMatchObject({ opened: false, caption: "No page this time." });
  });
});

describe("repairing a cut-off page", () => {
  it("drops a half tag or attribute and closes what's open", () => {
    expect(repairPartial('<div class="a"><p>Hello wor', true).html).toBe('<div class="a"><p>Hello wor</p></div>');
    expect(repairPartial('<div><span data-rows=\'[{"a":1', true).html).toBe("<div></div>");
    expect(repairPartial("<div><img src=\"https://x/y.png\" al", true).html).toBe("<div></div>");
    expect(repairPartial("<p>Fish &amp; chi", true).html).toBe("<p>Fish &amp; chi</p>");
    expect(repairPartial("<p>Fish &am", true).html).toBe("<p>Fish </p>");
    expect(repairPartial("<div>a<!-- a note that never", true).html).toBe("<div>a</div>");
  });

  it("keeps a style's finished rules and drops a half script", () => {
    expect(repairPartial("<style>.a{color:red}.b{colo", true).html).toBe("<style>.a{color:red}</style>");
    expect(repairPartial("<div>x</div><script>cv.line([1,2", true).html).toBe("<div>x</div>");
    expect(repairPartial("<style>.a{color:red}</style><div>x</div>", true).html).toBe("<style>.a{color:red}</style><div>x</div>");
  });

  it("leaves a whole page as it is", () => {
    expect(repairPartial(PAGE, true).html).toBe(PAGE);
    expect(repairPartial(PAGE).html).toBe(PAGE);
    expect(repairPartial(PAGE).done).toEqual(["title", "game-tetris", "game-links", "games", "source"]);
  });
});

describe("revealing parts", () => {
  const at = (marker: string) => PAGE.slice(0, PAGE.indexOf(marker) + marker.length);

  it("hides an open part with nothing finished in it", () => {
    const cut = repairPartial(at("<h1 class=\"cv-h1\">Five Chro"));
    expect(cut.pending).toEqual(["title"]);
    expect(cut.html).toContain('<header data-cv-id="title" data-cv-pending>');
    expect(cut.html.endsWith("Five Chro</h1></header></div>")).toBe(true);
  });

  it("shows an open part once it holds a part, and its finished parts, while a half card waits", () => {
    const cut = repairPartial(at('data-title="Link\'s Awakening DX">'));
    expect(cut.done).toEqual(["title", "game-tetris"]);
    expect(cut.open).toEqual(["games"]);
    expect(cut.pending).toEqual(["game-links"]);
    expect(cut.html).toContain('data-cv-id="games" data-cv-open>');
    expect(cut.html).toContain('data-title="Link\'s Awakening DX" data-cv-pending>');
    // The finished card is untouched.
    expect(cut.html).toContain('<div data-block="card" data-cv-id="game-tetris" data-title="Tetris DX" data-rating="9"></div>');
  });

  it("never shows a card whose opening tag is still being written", () => {
    const cut = repairPartial(at('data-cv-id="game-links" data-ti'));
    expect(cut.html).not.toContain("game-links");
    expect(cut.done).toEqual(["title", "game-tetris"]);
  });

  it("marks nothing when the turn ended mid-page", () => {
    const cut = repairPartial(at('data-title="Link\'s Awakening DX">'), true);
    expect(cut.html).not.toMatch(/data-cv-(pending|open)/);
    expect(cut.pending).toEqual([]);
  });
});

const delta = (seq: number, itemId: string, text: string): EventRow => ({ seq, type: "item/agentMessage/delta", data: { delta: text, itemId } });
const completed = (seq: number, id: string, text: string): EventRow => ({ seq, type: "item/completed", data: { item: { type: "agentMessage", id, text } } });

describe("assembling the reply", () => {
  it("joins deltas by seq, whatever order they arrive in, each seq once", () => {
    const turn = new TurnText();
    turn.add([delta(3, "m1", "c"), delta(1, "m1", "a")]);
    turn.add([delta(2, "m1", "b"), delta(3, "m1", "c"), delta(1, "m1", "a")]);
    expect(turn.text()).toBe("abc");
    expect(turn.lastSeq).toBe(3);
  });

  it("joins messages in the order they began, and a completed message replaces its deltas", () => {
    const turn = new TurnText();
    turn.add([delta(5, "m2", "second"), delta(1, "m1", "fir")]);
    turn.add([completed(4, "m1", "first message")]);
    expect(turn.text()).toBe("first message\n\nsecond");
    // A completed message with an id its deltas didn't have still finishes them.
    turn.add([completed(9, "other", "second, done")]);
    expect(turn.text()).toBe("first message\n\nsecond, done");
  });

  it("skips a sub-agent's text and other items", () => {
    const turn = new TurnText();
    turn.add([{ seq: 1, type: "item/agentMessage/delta", data: { delta: "inner", itemId: "x", parentToolCallId: "t1" } }, { seq: 2, type: "item/completed", data: { item: { type: "commandExecution" } } }, delta(3, "m", "outer")]);
    expect(turn.text()).toBe("outer");
  });
});

/** A fake event log a stream polls: rows appear as the test adds them. */
function fakeLog(start = 100) {
  const rows: EventRow[] = [];
  let clock = 0;
  const published: StreamUpdate[] = [];
  const stream = new PageStream({
    tip: async () => start,
    list: async (after, limit) => rows.filter((row) => row.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit),
    publish: (update) => published.push(update),
    fill: (html) => html.replace('data-cv-id="game-tetris"', 'data-cv-id="game-tetris" data-img="https://x/tetris.png"'),
    now: () => clock,
    sleep: async () => {},
  });
  return { rows, published, stream, tick: (ms: number) => { clock += ms; } };
}

describe("streaming a page", () => {
  it("publishes the growing page, throttled, once something shows, with found pictures", async () => {
    const { rows, published, stream, tick } = fakeLog();
    // Before the turn: not part of it.
    rows.push(delta(90, "old", "```html\n<p>old</p>"));
    let seq = 100;
    const say = (text: string) => rows.push(delta(++seq, "m1", text));
    say("I'll lay it out.\n```html style=field\n<style>.w{display:grid}</style>\n");
    await stream.poll();
    expect(published).toEqual([]); // only a style: nothing to see yet
    say('<div class="cv-fill">\n  <header data-cv-id="title"><h1>Five</h1></header>\n<div class="cv-wall" data-cv-id="games"><div data-block="card" data-cv-id="game-tetris" data-title="Tetris DX"></div>');
    tick(200);
    await stream.poll();
    expect(published).toHaveLength(1);
    expect(published[0]!.style).toBe("field");
    expect(published[0]!.html).toContain('data-cv-id="games" data-cv-open');
    expect(published[0]!.html).toContain('data-img="https://x/tetris.png"');
    expect(published[0]!.html).not.toContain("old");
    // Within the throttle: held until the next poll after it.
    say('<div data-block="card" data-cv-id="game-links" data-title="Link\'s Awakening DX"></div>');
    tick(50);
    await stream.poll();
    expect(published).toHaveLength(1);
    tick(150);
    await stream.poll();
    expect(published).toHaveLength(2);
    expect(published[1]!.html).toContain("game-links");
    // Nothing new: nothing sent.
    tick(500);
    await stream.poll();
    expect(published).toHaveLength(2);
  });

  it("starts after the log's tip and returns the whole text when stopped", async () => {
    const { rows, stream } = fakeLog(100);
    rows.push(delta(99, "old", "earlier turn"));
    stream.start();
    rows.push(delta(101, "m1", "```html\n<p>hi</p>\n```\nCaption."));
    const text = await stream.stop();
    expect(text).toBe("```html\n<p>hi</p>\n```\nCaption.");
  });
});

describe("the block closing", () => {
  it("calls onClose once, at once (whatever the throttle), and publishes nothing after it", async () => {
    const rows: EventRow[] = [];
    const published: StreamUpdate[] = [];
    const closed: string[] = [];
    let clock = 0;
    const stream = new PageStream({ tip: async () => 0, list: async (after) => rows.filter((row) => row.seq > after), publish: (update) => published.push(update), onClose: (page) => closed.push(page.html), now: () => clock });
    rows.push(delta(1, "m", '```html\n<h1 data-cv-id="t">Hi</h1>\n<p data-cv-id="b">Bo'));
    await stream.poll();
    expect(published).toHaveLength(1);
    rows.push(delta(2, "m", 'dy</p>\n```\nCaption.'));
    clock += 10; // inside the throttle
    await stream.poll();
    expect(closed).toEqual(['<h1 data-cv-id="t">Hi</h1>\n<p data-cv-id="b">Body</p>']);
    expect(stream.finished).toBe(true);
    rows.push(delta(3, "m", " More words."));
    clock += 1000;
    await stream.poll();
    expect(closed).toHaveLength(1);
    expect(published).toHaveLength(1);
  });
});

describe("stopping a stream", () => {
  it("reads once more and answers every stop the same; a halted stream doesn't read again", async () => {
    let reads = 0;
    const stream = new PageStream({ tip: async () => 0, list: async () => { reads++; return [delta(1, "m", "hello")]; }, publish: () => {}, sleep: async () => {} });
    const [a, b] = await Promise.all([stream.stop(), stream.stop()]);
    expect(a).toBe("hello");
    expect(b).toBe("hello");
    expect(reads).toBe(1);
    const halted = new PageStream({ tip: async () => 0, list: async () => { throw new Error("unreadable"); }, publish: () => {} });
    halted.halt();
    expect(await halted.stop()).toBe("");
  });
});

describe("the end of a turn", () => {
  it("commits the reply's closed block, and the words after it are the caption", () => {
    expect(turnPage(REPLY, null)).toMatchObject({ html: PAGE, caption: "Start with Link's Awakening: it's the one everyone finishes.", complete: true });
  });

  it("falls back to what streamed when the reply lacks the block, repaired when it never closed", () => {
    const cut = PAGE.slice(0, PAGE.indexOf("data-cv-id=\"game-links\""));
    const result = turnPage("Start with Tetris.", `\`\`\`html\n${cut}`);
    expect(result.complete).toBe(false);
    expect(result.caption).toBe("Start with Tetris.");
    expect(result.html).toContain('data-cv-id="game-tetris"');
    expect(result.html).not.toContain("data-cv-pending");
    expect(result.html!.endsWith("</div></div>")).toBe(true);
  });

  it("commits a reply that ended mid-page", () => {
    const result = turnPage(`\`\`\`html\n${PAGE.slice(0, 200)}`, null);
    expect(result.complete).toBe(false);
    expect(result.html).toBeTruthy();
    expect(result.caption).toBeNull();
  });

  it("keeps the board when no html arrived, and the reply is the caption", () => {
    expect(turnPage("Prices went up 3%.", "Prices went up 3%.")).toEqual({ html: null, caption: "Prices went up 3%.", style: null, title: null, complete: false });
    expect(turnPage(null, null)).toMatchObject({ html: null, caption: null });
  });
});
