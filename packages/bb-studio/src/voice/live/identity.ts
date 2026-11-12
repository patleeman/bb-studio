// Who a hands-free session speaks as: the thread it was launched from
// (docs/voice/identity.md). The seed is built once at session start, from
// cheap sources only (Studio's records, the Memory page's stored markdown,
// one timeline read, the todos store), and kept for the session: it goes into
// the voice's instructions and is never rebuilt per turn. No LLM call.
import { speakable } from "./speakable";

/** About 1,500 tokens, at about four characters a token. */
export const SEED_TOKEN_CAP = 1500;
export const SEED_CHAR_CAP = SEED_TOKEN_CAP * 4;
/** Each section's budget, in characters; together under the cap. */
export const SEED_BUDGET = { role: 400, memory: 1100, loops: 800, recent: 1700, latestReply: 1500 } as const;
export const RECENT_MESSAGES = 6;
const MESSAGE_CHARS = 280;
const NEEDS_YOU_NOW = 6;
const COMING_UP = 4;

export type IdentityKind = "cos" | "bot" | "lead" | "runner" | "thread";

/** Who the session is, for the pill, the instructions and the default relay target. */
export interface VoiceIdentity {
  kind: IdentityKind;
  /** What the pill shows: "Chief of Staff", a Bot's name or the thread's title. */
  label: string;
  /** The name it speaks as: the Bot's name, or the thread's title. */
  name: string;
  /** Where relays go by default: the launching thread (the CoS chat for the CoS). */
  threadId: string | null;
}

export interface SeedMessage { role: "user" | "assistant"; text: string }

/** What the builder gets; null means the source was missing or unreadable. */
export interface SeedInput {
  kind: IdentityKind;
  name: string;
  threadId: string | null;
  role: string | null;
  /** The Chief of Staff's Memory page, as markdown. */
  memory?: string | null;
  /** The thread's latest messages, oldest first. */
  recent: SeedMessage[] | null;
  /** Todos' titles, for the Chief of Staff. */
  loops?: { needsYouNow: string[]; comingUp: string[] } | null;
  project?: string | null;
}

export interface VoiceSeed {
  identity: VoiceIdentity;
  /** The context block for the instructions; at most SEED_CHAR_CAP characters. */
  text: string;
  /** Sources that were missing: "memory", "recent", "todos". */
  missing: string[];
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** The Memory page's essentials: without its "## Check-in" list (the Bot's own to-dos), as plain lines. */
export function memoryEssentials(markdown: string, max = SEED_BUDGET.memory): string {
  const withoutCheckin = markdown.replace(/^##\s*Check-in\b[^\n]*\n[\s\S]*?(?=^##\s|(?![\s\S]))/im, "");
  const text = speakable(withoutCheckin).split("\n").map(oneLine).filter(Boolean).join("\n");
  return clip(text, max);
}

/** Fits lines into a budget, newest kept: the oldest go first. */
function newestWithin(lines: string[], max: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const line of [...lines].reverse()) {
    if (used + line.length + 1 > max) break;
    kept.unshift(line);
    used += line.length + 1;
  }
  return kept;
}

export function buildSeed(input: SeedInput): VoiceSeed {
  const cos = input.kind === "cos";
  const identity: VoiceIdentity = { kind: input.kind, label: cos ? "Chief of Staff" : input.name, name: input.name, threadId: input.threadId };
  const missing: string[] = [];
  const sections: string[] = [];
  const role = input.role?.trim() ? clip(oneLine(input.role), SEED_BUDGET.role) : null;
  sections.push([
    cos ? `You are ${input.name}, the user's Chief of Staff.` : input.kind === "bot" ? `You are ${input.name}, one of the user's Bots.` : `You speak for the thread "${input.name}".`,
    role ? `Role: ${role}` : "",
    input.project ? `Project: ${clip(oneLine(input.project), 120)}` : "",
  ].filter(Boolean).join("\n"));
  if (cos) {
    const memory = input.memory?.trim() ? memoryEssentials(input.memory) : "";
    if (memory) sections.push(`Memory (the essentials):\n${memory}`);
    else missing.push("memory");
    if (input.loops) {
      const now = input.loops.needsYouNow.slice(0, NEEDS_YOU_NOW).map((title) => `- ${clip(oneLine(title), 120)}`);
      const soon = input.loops.comingUp.slice(0, COMING_UP).map((title) => `- ${clip(oneLine(title), 120)}`);
      const loops = [now.length ? `Needs you now:\n${now.join("\n")}` : "Nothing needs the user right now.", soon.length ? `Coming up:\n${soon.join("\n")}` : ""].filter(Boolean).join("\n");
      sections.push(`Todos (titles):\n${clip(loops, SEED_BUDGET.loops)}`);
    } else missing.push("todos");
  }
  const latest = (input.recent ?? []).filter((message) => message.role === "assistant" && message.text.trim()).at(-1);
  if (latest) sections.push(`Your latest reply in this chat:
${clip(speakable(latest.text), SEED_BUDGET.latestReply)}`);
  const messages = (input.recent ?? []).filter((message) => message.text.trim()).slice(-RECENT_MESSAGES)
    .map((message) => `${message.role === "user" ? "User" : input.name}: ${clip(oneLine(speakable(message.text)), MESSAGE_CHARS)}`);
  if (input.recent === null) missing.push("recent");
  if (messages.length) sections.push(`Lately in this chat (oldest first):\n${newestWithin(messages, SEED_BUDGET.recent).join("\n")}`);
  else if (input.recent !== null) sections.push("Lately in this chat: nothing yet.");
  if (missing.length) sections.push(`Not available now: ${missing.join(", ")}. If asked about it, don't guess: say so and offer to ask ${cos ? "your chat" : "the thread"}.`);
  return { identity, text: clip(sections.join("\n\n"), SEED_CHAR_CAP), missing };
}

/** Where the seed's sources come from (server.ts gives Studio's real ones). */
export interface SeedSources {
  /** Every Bot; `primary` is the Chief of Staff. */
  bots(): { name: string; role: string | null; threadId: string | null; memoryPageId: string | null; primary: boolean }[];
  /** A page's stored markdown, or null. */
  memory(pageId: string): string | null;
  /** The name of the project a thread leads, if it's a project lead. */
  leadOf(threadId: string): Promise<string | null> | string | null;
  /** The runner a thread runs, if any. */
  runnerOf(threadId: string): { name: string; job: string } | null;
  thread(threadId: string): Promise<{ title: string; project: string | null } | null>;
  /** The thread's latest messages, oldest first; throws or returns null when unreadable. */
  recent(threadId: string): Promise<SeedMessage[] | null>;
  /** Todos' titles; null when Todos are off. */
  loops(): { needsYouNow: string[]; comingUp: string[] } | null;
}

const settle = <T>(promise: Promise<T>): Promise<T | null> => promise.catch(() => null);
const safe = <T>(read: () => T): T | null => { try { return read(); } catch { return null; } };

/** The seed's input for a launching thread; no thread, an unknown one or the CoS chat means the Chief of Staff. */
export async function gatherSeed(threadId: string | null | undefined, sources: SeedSources): Promise<SeedInput | null> {
  const bots = sources.bots();
  const cos = bots.find((bot) => bot.primary) ?? null;
  const forCos = async (): Promise<SeedInput | null> => {
    if (!cos) return null;
    const recent = cos.threadId ? await settle(sources.recent(cos.threadId)) : null;
    return {
      kind: "cos", name: cos.name, threadId: cos.threadId, role: cos.role,
      memory: cos.memoryPageId ? safe(() => sources.memory(cos.memoryPageId!)) : null,
      loops: safe(() => sources.loops()), recent,
    };
  };
  if (!threadId || threadId === cos?.threadId) return forCos();
  const [thread, recent] = await Promise.all([settle(sources.thread(threadId)), settle(sources.recent(threadId))]);
  if (!thread) return forCos();
  const bot = bots.find((each) => each.threadId === threadId);
  if (bot) return { kind: "bot", name: bot.name, threadId, role: bot.role, recent, project: thread.project };
  const led = await settle(Promise.resolve().then(() => sources.leadOf(threadId)));
  if (led) return { kind: "lead", name: thread.title, threadId, role: `Lead of the ${led} project.`, recent, project: thread.project ?? led };
  const runner = safe(() => sources.runnerOf(threadId));
  if (runner) return { kind: "runner", name: thread.title, threadId, role: `The runner "${runner.name}". Its job: ${runner.job}`, recent, project: thread.project };
  return { kind: "thread", name: thread.title, threadId, role: null, recent, project: thread.project };
}
