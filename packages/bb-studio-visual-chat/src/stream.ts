// A page streamed in the reply. For a full page the agent writes ONE fenced
// html block in its reply text (after one canvas_images call), then a short
// caption line. BB's providers write the reply's text to the thread's event
// log as it's generated (item/agentMessage/delta, coalesced about every 50 ms,
// pruned once the message completes); tool input never streams. So while a
// canvas thread works, the server polls its log, assembles the text, takes the
// growing html block, repairs it into markup that parses (half tags dropped,
// open elements closed) and publishes it to the page, which builds the board
// part by part. The moment the block closes, it's committed as the page and
// the turn's version (as canvas_page makes it); when the thread goes idle, the
// caption (the words after the block) and anything that arrived after the
// block (pictures, patches) fill that same version in. A turn whose block
// never closed is committed at idle from what arrived.
//
// The page reveals a part (data-cv-id) once its element is closed. The repair
// marks the open ones: an open part with no part inside yet is
// data-cv-pending (hidden, its space kept), and an open part that already
// holds parts is data-cv-open (shown, so its finished parts show).
import { ORGANIC_LOOKS, type OrganicLook } from "./looks";

const isOrganicLook = (value: string): value is OrganicLook => (ORGANIC_LOOKS as readonly string[]).includes(value);

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);

// ─── The fence ───────────────────────────────────────────────────────────────

export interface FencedPage {
  /** The html block began (its opening line is complete). */
  opened: boolean;
  /** Its closing fence arrived. */
  closed: boolean;
  /** What's inside the block so far. */
  html: string;
  /** The words outside the block: the caption (after it, else before it). */
  caption: string;
  /** From the fence line: ```html style=field title="…". */
  style: OrganicLook | null;
  title: string | null;
}

const OPEN = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*html\b([^\n`]*)\n/gi;

/** The last html block in the text, closed or still growing. */
export function extractPage(text: string): FencedPage {
  let open: RegExpExecArray | null = null;
  for (let match: RegExpExecArray | null; (match = OPEN.exec(text));) open = match;
  OPEN.lastIndex = 0;
  if (!open) return { opened: false, closed: false, html: "", caption: text.trim(), style: null, title: null };
  const fence = open[2]!;
  const info = open[3] ?? "";
  const start = open.index + open[0].length;
  const before = text.slice(0, open.index + open[1]!.length);
  // The closing fence: a line of at least as many of the same marks (it may start the body: an empty block).
  const close = new RegExp(`(^|\\n)[ \\t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*(?=\\n|$)`);
  const body = text.slice(start);
  const end = close.exec(body);
  const style = /\bstyle\s*=\s*["']?([a-z]+)/i.exec(info)?.[1]?.toLowerCase() ?? null;
  const title = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(info)?.slice(1).find((v) => v !== undefined)?.trim() || null;
  const look = style && isOrganicLook(style) ? style : null;
  if (end) {
    const html = body.slice(0, end.index);
    const after = body.slice(end.index + end[0].length);
    return { opened: true, closed: true, html, caption: (after.trim() || before.trim()), style: look, title };
  }
  // Still growing: a closing fence that's half there (a line of backticks) isn't page.
  const html = body.replace(/(^|\n)[ \t]*[`~]{1,}[ \t]*$/, "$1");
  return { opened: true, closed: false, html, caption: before.trim(), style: look, title };
}

// ─── Repair ─────────────────────────────────────────────────────────────────

interface OpenTag { name: string; at: number; end: number; id: string | null; block: boolean; parts: number }

const idOf = (attrs: string) => /\bdata-cv-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs)?.slice(1).find((v) => v !== undefined) ?? null;

export interface Repaired {
  html: string;
  /** Parts whose element is closed, in order. */
  done: string[];
  /** Open parts with nothing finished inside: hidden for now (data-cv-pending). */
  pending: string[];
  /** Open parts that already hold parts: shown (data-cv-open). */
  open: string[];
}

/**
 * Markup that parses, from a page cut off anywhere: a trailing half tag, attribute, comment or entity is
 * dropped, an open <style> keeps its finished rules, an open <script> is dropped (a half script never runs),
 * and every open element is closed. Open parts are marked so the page can hide them (see the top of the file);
 * `final` closes everything without marks, for a reply that ended mid-page.
 */
export function repairPartial(source: string, final = false): Repaired {
  let html = source;
  const stack: OpenTag[] = [];
  const done: string[] = [];
  const re = /<!--|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let cut = html.length;
  let raw: { name: string; bodyAt: number } | null = null;
  for (let match: RegExpExecArray | null; (match = re.exec(html));) {
    if (match[0] === "<!--") {
      const end = html.indexOf("-->", re.lastIndex);
      if (end < 0) { cut = match.index; break; }
      re.lastIndex = end + 3;
      continue;
    }
    const name = match[2]!.toLowerCase();
    const attrs = match[3] ?? "";
    if (match[1] === "/") {
      const at = stack.map((tag) => tag.name).lastIndexOf(name);
      if (at < 0) continue;
      for (const tag of stack.splice(at)) if (tag.id) done.push(tag.id);
      continue;
    }
    const id = idOf(attrs);
    for (const tag of stack) if (id) tag.parts++;
    if (VOID.has(name) || /\/\s*$/.test(attrs)) { if (id) done.push(id); continue; }
    stack.push({ name, at: match.index, end: re.lastIndex, id, block: /\bdata-block\s*=/i.test(attrs), parts: 0 });
    if (RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, re.lastIndex);
      if (end < 0 || html.indexOf(">", end) < 0) { raw = { name, bodyAt: re.lastIndex }; break; }
      re.lastIndex = end;
    }
  }
  if (raw) {
    // An open script or style: a script goes; a style keeps its finished rules.
    const tag = stack.pop()!;
    if (raw.name === "style") {
      const body = html.slice(raw.bodyAt);
      const last = body.lastIndexOf("}");
      html = `${html.slice(0, raw.bodyAt)}${last >= 0 ? body.slice(0, last + 1) : ""}</style>`;
    } else if (raw.name === "script") {
      html = html.slice(0, tag.at);
    } else {
      html = `${html}</${raw.name}>`;
    }
  } else {
    // Text after the last tag: a half tag (an unmatched "<") or a half entity at the very end goes.
    const tail = html.slice(0, cut);
    const lastOpen = tail.lastIndexOf("<");
    html = lastOpen >= 0 && tail.indexOf(">", lastOpen) < 0 ? tail.slice(0, lastOpen) : tail;
    html = html.replace(/&#?[a-zA-Z0-9]*$/, "");
  }
  const pending: string[] = [];
  const open: string[] = [];
  const marks: { at: number; text: string }[] = [];
  if (!final) {
    for (const tag of stack) {
      if (!tag.id) continue;
      // A block (a card) builds from its own attributes and shows whole; anything else with no parts yet waits.
      const waits = tag.block || tag.parts === 0;
      (waits ? pending : open).push(tag.id);
      marks.push({ at: tag.end - 1, text: waits ? " data-cv-pending" : " data-cv-open" });
    }
  }
  for (const mark of marks.sort((a, b) => b.at - a.at)) html = html.slice(0, mark.at) + mark.text + html.slice(mark.at);
  html += stack.slice().reverse().map((tag) => `</${tag.name}>`).join("");
  return { html, done, pending, open };
}

// ─── The reply's text, from the event log ───────────────────────────────────

/** A row of threads.events.list, as far as streaming reads it. */
export interface EventRow {
  seq: number;
  type: string;
  data?: { delta?: string; itemId?: string; parentToolCallId?: string; item?: { type?: string; id?: string; text?: string } } | null;
}

export const STREAM_EVENT_TYPES = ["item/agentMessage/delta", "item/completed"] as const;

/**
 * The turn's reply text, assembled from delta and completed-message rows in any order, each seq once. A
 * message's deltas join in seq order; its completed text, when it comes, replaces them (deltas are pruned once a
 * message completes, so a late poller still gets the whole message). Messages join in the order they began.
 * Text a sub-agent writes (parentToolCallId) isn't the reply.
 */
export class TurnText {
  private readonly seen = new Set<number>();
  private readonly items = new Map<string, { first: number; parts: Map<number, string>; final: string | null }>();
  lastSeq = 0;

  add(rows: readonly EventRow[]): boolean {
    let changed = false;
    for (const row of rows) {
      if (!Number.isFinite(row.seq) || this.seen.has(row.seq)) continue;
      this.seen.add(row.seq);
      this.lastSeq = Math.max(this.lastSeq, row.seq);
      const data = row.data ?? {};
      if (data.parentToolCallId) continue;
      if (row.type === "item/agentMessage/delta" && typeof data.delta === "string" && data.itemId) {
        const item = this.item(data.itemId, row.seq);
        if (item.final !== null) continue;
        item.parts.set(row.seq, data.delta);
        changed = true;
      } else if (row.type === "item/completed" && data.item?.type === "agentMessage" && typeof data.item.text === "string") {
        const id = data.item.id && this.items.has(data.item.id) ? data.item.id : this.matching(data.item.text) ?? data.item.id ?? `completed:${row.seq}`;
        const item = this.item(id, row.seq);
        if (item.final !== data.item.text) { item.final = data.item.text; changed = true; }
      }
    }
    return changed;
  }

  text(): string {
    return [...this.items.values()]
      .sort((a, b) => a.first - b.first)
      .map((item) => item.final ?? [...item.parts.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]).join(""))
      .filter((text) => text.length)
      .join("\n\n");
  }

  private item(id: string, seq: number) {
    let item = this.items.get(id);
    if (!item) { item = { first: seq, parts: new Map(), final: null }; this.items.set(id, item); }
    item.first = Math.min(item.first, seq);
    return item;
  }

  /** A completed message whose id doesn't match its deltas': the streamed message it finishes. */
  private matching(text: string): string | null {
    for (const [id, item] of this.items) {
      if (item.final !== null) continue;
      const sofar = [...item.parts.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]).join("");
      if (sofar && text.startsWith(sofar.slice(0, 200))) return id;
    }
    return null;
  }
}

// ─── The poller ─────────────────────────────────────────────────────────────

export interface StreamUpdate {
  /** The partial page, repaired and marked, with found pictures in its cards. */
  html: string;
  /** The board's style, from the fence line. */
  style: OrganicLook | null;
}

export interface PageStreamDeps {
  /** Rows after a seq, ascending, of STREAM_EVENT_TYPES; at most `limit`. */
  list(afterSeq: number, limit: number): Promise<EventRow[]>;
  /** The log's latest seq now (rows up to it are from before this turn). */
  tip(): Promise<number>;
  publish(update: StreamUpdate): void;
  /** The html block closed: the page is finished (called once; nothing more is published after it). */
  onClose?(page: FencedPage): void;
  /** Puts found pictures into cards (page.ts fillPictures). */
  fill?(html: string): string;
  intervalMs?: number;
  throttleMs?: number;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  onError?(error: unknown): void;
}

/** Rows per read: BB answers "Thread event limit cannot exceed 100" above it. */
const PAGE_LIMIT = 100;

/**
 * Polls one thread's log while it works and publishes the growing page, at most every throttleMs (default 150:
 * about 6 a second), and only when it changed and shows something (a finished part, or text). stop() reads the
 * log once more and returns the assembled text.
 */
export class PageStream {
  readonly text = new TurnText();
  private stopped = false;
  private loop: Promise<void> | null = null;
  private stopping: Promise<string> | null = null;
  private lastHtml = "";
  private lastAt = -Infinity;
  private started = false;
  private closed = false;
  published = 0;

  constructor(private readonly deps: PageStreamDeps) {}

  start(): void {
    if (this.loop) return;
    this.loop = (async () => {
      try { this.text.lastSeq = Math.max(this.text.lastSeq, await this.deps.tip()); } catch (error) { this.deps.onError?.(error); }
      const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
      while (!this.stopped) {
        await this.poll();
        if (!this.stopped) await sleep(this.deps.intervalMs ?? 180);
      }
    })();
  }

  /** One read of the log; publishes when the page grew. */
  async poll(): Promise<void> {
    try {
      await this.read();
    } catch (error) {
      this.deps.onError?.(error);
    }
    this.flush();
  }

  /** Everything new in the log, a page at a time (a page that doesn't move the seq on ends it). */
  private async read(): Promise<void> {
    for (let page = 0; page < 50; page++) {
      const before = this.text.lastSeq;
      const rows = await this.deps.list(before, PAGE_LIMIT);
      this.text.add(rows);
      if (rows.length < PAGE_LIMIT || this.text.lastSeq <= before) break;
    }
  }

  /** Stops polling at once, without a last read (the log can't be read). */
  halt(): void { this.stopped = true; }

  private flush(): void {
    if (this.closed) return;
    const found = extractPage(this.text.text());
    if (!found.opened) return;
    // The block closed: the page is finished, whatever the throttle says. The rest of the turn isn't page.
    if (found.closed && found.html.trim() && this.deps.onClose) {
      this.closed = true;
      this.deps.onClose(found);
      return;
    }
    const now = (this.deps.now ?? Date.now)();
    if (now - this.lastAt < (this.deps.throttleMs ?? 150)) return;
    const repaired = repairPartial(found.html);
    const html = this.deps.fill ? this.deps.fill(repaired.html) : repaired.html;
    if (html === this.lastHtml) return;
    // Nothing to see yet (a <style>, a half-open header): keep the board on screen as it is.
    const visible = repaired.done.length > 0 || repaired.open.length > 0 || stripTags(html).length > 0;
    if (!this.started && !visible) return;
    this.started = true;
    this.lastHtml = html;
    this.lastAt = now;
    this.published++;
    this.deps.publish({ html, style: found.style });
  }

  /** Stops polling after one last read; the turn's assembled text. Once: later calls get the same answer. */
  stop(): Promise<string> {
    this.stopping ??= (async () => {
      const halted = this.stopped;
      this.stopped = true;
      await this.loop?.catch(() => {});
      if (!halted) {
        try { await this.read(); } catch (error) { this.deps.onError?.(error); }
      }
      return this.text.text();
    })();
    return this.stopping;
  }

  /** Whether the html block closed while streaming. */
  get finished(): boolean { return this.closed; }

  /** Whether anything of a page went to the page. */
  get showed(): boolean { return this.started; }
}

const stripTags = (html: string) => html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<[^>]*>/g, "").replace(/\s+/g, "");

// ─── The end of the turn ────────────────────────────────────────────────────

export interface TurnPage {
  /** The page to commit (complete, or repaired from what arrived), or null: keep the board. */
  html: string | null;
  /** The caption: the words outside the block, else the whole reply. */
  caption: string | null;
  style: OrganicLook | null;
  title: string | null;
  /** Whether the block closed (false: committed what arrived). */
  complete: boolean;
}

/**
 * The page a finished turn leaves: the final reply's html block, closed. If the reply has no closed block, the
 * longest block that arrived (the reply's own, or the streamed text's) is committed, repaired. No block at all:
 * no page, and the reply is the caption.
 */
export function turnPage(reply: string | null, streamed: string | null): TurnPage {
  const final = extractPage(reply ?? "");
  const fromStream = extractPage(streamed ?? "");
  let pick: FencedPage | null = null;
  if (final.opened && final.closed && final.html.trim()) pick = final;
  else {
    const candidates = [final, fromStream].filter((each) => each.opened && each.html.trim());
    pick = candidates.find((each) => each.closed) ?? candidates.sort((a, b) => b.html.length - a.html.length)[0] ?? null;
  }
  const replyCaption = final.opened ? final.caption : (reply ?? "").trim();
  if (!pick) return { html: null, caption: replyCaption || null, style: null, title: null, complete: false };
  const html = pick.closed ? pick.html.trim() : repairPartial(pick.html, true).html.trim();
  return { html: html || null, caption: (replyCaption || (pick === fromStream ? fromStream.caption : "")) || null, style: pick.style, title: pick.title, complete: pick.closed };
}
