import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { APP_POINTER, CONTINUE_POINTER, endOfReplyPointer, MINI_POINTER, PAGE_POINTER, studioInstructions, STRAND_POINTER } from "./agent-instructions";
import { botInstructions } from "./bot";
import { conversationInstructions } from "./bot-threads";
import { DEFAULT_REPLIES } from "./explore/prompt";
import { BUILTIN_KINDS, resolveKinds, routingInstructions } from "./kinds";
import { MemoryService, withMemory } from "./memory/service";
import { INSTRUCTIONS_LIMIT } from "./memory/shared";
import { CORE_TEMPLATE } from "./core-skill";
import { STUDIO_SETTINGS } from "./settings/schema";

/** A Bot like Chief of Staff: a role in the user's words and eight skills. */
function realisticBot(): string {
  const skills = Array.from({ length: 8 }, (_, n) => ({ name: `weekly-task-${n}`, description: "Use when the user asks for the weekly staff sweep or the homelab backup check; the steps and what to report." }));
  return botInstructions({ name: "Chief of Staff", state: "active", primary: true, role: "Runs Sam's personal ops: inbox triage, calendar, the home server, launch prep and the BB Studio fork.", skills });
}

/** A typical always-on core skill: a dozen preferences, a few "right now" lines, the check-in list. */
const PROFILE = CORE_TEMPLATE
  .replace("## Preferences\n", `## Preferences\n\n${Array.from({ length: 5 }, (_, n) => `- Rule ${n}: one clear recommendation; say what failed.`).join("\n")}\n`)
  .replace("## Right now\n", "## Right now\n\n- Travelling until the 9th: keep replies short.\n- The launch is in review: don't change the site.\n");

function memoryFor(skills: { name: string; body: string }[]) {
  return new MemoryService({
    bots: { list: () => [{ id: "bot_main", name: "Chief of Staff", primary: true }] },
    alwaysOn: () => skills,
    botThread: (threadId) => (threadId === "thr_main" ? { botId: "bot_main", kind: "conversation", isMain: true, title: null } : threadId === "thr_worker" ? { botId: "bot_main", kind: "worker", isMain: false, title: null } : null),
    sideBot: () => null, ownedBot: () => null, chainBot: () => null, ownBot: () => null, runnerBot: () => null,
  });
}

it("keeps a typical conversation's instructions within 4,096 characters, the Bot, the note and the whole always-on skill first", async () => {
  const memory = memoryFor([{ name: "core-profile", body: PROFILE }]);
  const profile = PROFILE.trim();
  const bot = realisticBot();
  const note = conversationInstructions({ isMain: false, forkedFrom: { threadId: "thr_main", messageId: null, turnId: null } }, "Fork redesign", "Main");
  const settings = { off: ["design"], use: {} };
  const routing = routingInstructions(resolveKinds([], settings), settings);
  const inner = () => ({
    tools: [], skills: ["studio-code", "studio"],
    instructions: studioInstructions({ bot, conversation: note, runner: "", pages: true, minis: true, appCards: false, endOfReply: endOfReplyPointer({ next: true, explore: true, replies: DEFAULT_REPLIES }), routing }),
  });
  const { instructions } = withMemory(() => memory, () => false, inner)({ thread: { id: "thr_main", parentThreadId: null, sourceThreadId: null }, pluginMetadata: {} });
  expect(instructions.length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT);
  // In order: the Bot, which conversation, memory with the whole profile, then the pointers.
  const at = (text: string) => instructions.indexOf(text);
  expect(at(bot)).toBe(0);
  expect(at(note)).toBeGreaterThan(0);
  expect(at("## Memory")).toBeGreaterThan(at(note));
  expect(instructions).toContain(`<always-on skill="core-profile">\n${profile}\n</always-on>`);
  expect(instructions).not.toContain("Cut here");
  expect(instructions).not.toMatch(/memory \(op|memory_search|memory records/);
  expect(at(PAGE_POINTER)).toBeGreaterThan(at("</always-on>"));
  expect(at(MINI_POINTER)).toBeGreaterThan(at(PAGE_POINTER));
  expect(at(STRAND_POINTER)).toBeGreaterThan(at(MINI_POINTER));
  expect(at(CONTINUE_POINTER)).toBeGreaterThan(at(STRAND_POINTER));
  expect(instructions).toContain("::next{reply=\"…\" btw=\"…\" do=\"…\"}");
  expect(instructions).toContain("Quick replies to prefer: 👍 Looks good | 🔁 Try another way | ❓ Explain more.");
  expect(instructions.endsWith("Studio kinds: designs are off, don't offer them.")).toBe(true);
});

it("never cuts an always-on skill silently: what doesn't fit says so and where the rest is", () => {
  const long = `## Preferences\n\n${"- A rule that matters to the user.\n".repeat(150)}`;
  const memory = memoryFor([{ name: "core-profile", body: long }]);
  const conversation = memory.instructionsFor({ botId: "bot_main", role: "conversation" }, 2000)!;
  expect(conversation.length).toBeLessThanOrEqual(2000);
  expect(conversation).toMatch(/\(Cut here: core-profile didn't fit; always-on skills are 5,\d{3} characters, over their 3,000 budget\. read the rest with bot_skill \(op: view, name: "core-profile"\)\.\)$/);
  const worker = memory.instructionsFor({ botId: "bot_main", role: "worker" }, 2000)!;
  expect(worker).toMatch(/^## Memory\nYou work for "Chief of Staff"/);
  expect(worker).toMatch(/ask the Bot or open its Memory page/);
  // Room to spare: whole, no note.
  expect(memoryFor([{ name: "core-profile", body: PROFILE }]).instructionsFor({ botId: "bot_main", role: "worker" })).not.toContain("Cut here");
  // External Bots and sessions without a Bot get nothing.
  expect(memory.threadRole({ thread: { id: "thr_other", parentThreadId: null, sourceThreadId: null }, pluginMetadata: {} })).toBeNull();
  expect(memory.threadRole({ thread: { id: "thr_worker", parentThreadId: null, sourceThreadId: null }, pluginMetadata: {} })).toEqual({ botId: "bot_main", role: "worker" });
});

it("keeps each pointer to one or two lines and says which end-of-reply attributes are on", () => {
  const pointers = [PAGE_POINTER, MINI_POINTER, APP_POINTER, STRAND_POINTER, CONTINUE_POINTER, endOfReplyPointer({ next: true, explore: true, replies: DEFAULT_REPLIES })!, endOfReplyPointer({ next: false, explore: true, replies: null })!];
  for (const pointer of pointers) {
    expect(pointer).not.toContain("\n");
    expect(pointer.length).toBeLessThanOrEqual(320);
  }
  expect(endOfReplyPointer({ next: true, explore: false, replies: null })).toBe('When a reply has next steps, end it with one ::next{do="…"} line; load the studio skill ("The Next row") for its rules before you write one. No reply= (quick replies are off).');
  expect(endOfReplyPointer({ next: false, explore: true, replies: [] })).toContain("::explore{items=");
  expect(endOfReplyPointer({ next: false, explore: false, replies: [] })).toBeNull();
  expect(studioInstructions({ bot: "", conversation: "", runner: "", pages: false, minis: false, appCards: false, endOfReply: null, routing: "" })).toBe("\u0000studio-memory\u0000");
  expect(BUILTIN_KINDS.length).toBeGreaterThan(0);
});

it("describes apps, and says ::mini by default and ::app with the App cards setting on", () => {
  const parts = { bot: "", conversation: "", runner: "", pages: false, minis: true, endOfReply: null, routing: "" };
  const off = studioInstructions({ ...parts, appCards: false });
  expect(off).toContain(MINI_POINTER);
  expect(off).toContain('::mini{id="mini_…"}');
  expect(off).not.toContain("::app{");
  const on = studioInstructions({ ...parts, appCards: true });
  expect(on).toContain(APP_POINTER);
  expect(on).toContain('::app{id="…"}');
  expect(on).not.toContain("::mini{");
  for (const pointer of [MINI_POINTER, APP_POINTER]) expect(pointer).toContain("An app is a saved output");
  expect(STUDIO_SETTINGS.appCards).toMatchObject({ type: "boolean", default: false, label: "App cards" });
});

it("moves the long guidance into the studio skill, which the pointers name", () => {
  const skill = readFileSync(new URL("../skills/studio/SKILL.md", import.meta.url), "utf8");
  expect(skill).toMatch(/^---\nname: studio\n/);
  for (const heading of ["## Agent guide", "### Pages", "### Apps", "### The Next row", "### Explore", "### Kinds"]) expect(skill).toContain(heading);
  // The rules that were in every session's instructions.
  expect(skill).toContain("call those\nscheduled items, never automations");
  expect(skill).toContain("Never put `@thread:` inside a Markdown\nlink");
  for (const rule of ["```chart", "replace_all only when asked", "sandboxed iframe", "pages_read (comments)", "apps (op: update)", "one stray \" breaks the whole line", "“curly” quotes", "Don't also write ::reactions or ::explore lines", "1 to 4 items separated by |"]) expect(skill).toContain(rule);
});

it("tells only a Bot's conversations to propose a new conversation and wait for a yes", () => {
  const parts = { bot: "", runner: "", pages: false, minis: false, appCards: false, endOfReply: null, routing: "" };
  expect(studioInstructions({ ...parts, conversation: "This is Main." })).toContain(CONTINUE_POINTER);
  expect(studioInstructions({ ...parts, conversation: "" })).not.toContain(CONTINUE_POINTER);
  expect(CONTINUE_POINTER).toContain("Offer a new conversation");
  expect(CONTINUE_POINTER).toContain("only when they agree or ask");
  expect(CONTINUE_POINTER).toContain("conversation_continue_new");
  const skill = readFileSync(new URL("../skills/studio/SKILL.md", import.meta.url), "utf8");
  for (const rule of ["conversation_continue_new { title, handoff,", "act only when the user agrees", "It is not the transcript", "the phone shows\n  the link"]) expect(skill).toContain(rule);
});
