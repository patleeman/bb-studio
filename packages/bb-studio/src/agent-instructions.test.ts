import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { endOfReplyPointer, MINI_POINTER, PAGE_POINTER, studioInstructions } from "./agent-instructions";
import { botInstructions } from "./bot";
import { conversationInstructions } from "./bot-threads";
import { DEFAULT_REPLIES } from "./explore/prompt";
import { BUILTIN_KINDS, resolveKinds, routingInstructions } from "./kinds";
import { withMemory } from "./memory/service";
import { INSTRUCTIONS_LIMIT } from "./memory/shared";
import { memoryHost } from "./memory/test-fixture";

/** A Bot like Chief of Staff: a role in the user's words and eight skills. */
function realisticBot(): string {
  const skills = Array.from({ length: 8 }, (_, n) => ({ name: `weekly-task-${n}`, description: "Use when the user asks for the weekly staff sweep or the homelab backup check; the steps and what to report." }));
  return botInstructions({ name: "Chief of Staff", state: "active", primary: true, role: "Runs Patrick's personal ops: inbox triage, calendar, the home server, launch prep and the BB Studio fork.", skills });
}

it("keeps a typical conversation's instructions within 4,096 characters, the Bot, the note and the whole core profile first", async () => {
  const x = await memoryHost();
  x.legacy("bot_main");
  x.memory.autoSplit("bot_main");
  const profile = x.pages.get("pg_new1")!.markdown.trim();
  const bot = realisticBot();
  const note = conversationInstructions({ isMain: false, forkedFrom: { threadId: "thr_main", messageId: null, turnId: null } }, "Fork redesign", "Main");
  const settings = { off: ["design"], use: {} };
  const routing = routingInstructions(resolveKinds([], settings), settings);
  const inner = () => ({
    tools: [], skills: ["studio-code", "studio"],
    instructions: studioInstructions({ bot, conversation: note, runner: "", pages: true, minis: true, endOfReply: endOfReplyPointer({ next: true, explore: true, replies: DEFAULT_REPLIES }), routing }),
  });
  const { instructions } = withMemory(() => x.memory, () => false, inner)({ thread: { id: "thr_main", parentThreadId: null, sourceThreadId: null }, pluginMetadata: {} });
  expect(instructions.length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT);
  // In order: the Bot, which conversation, memory with the whole profile, then the pointers.
  const at = (text: string) => instructions.indexOf(text);
  expect(at(bot)).toBe(0);
  expect(at(note)).toBeGreaterThan(0);
  expect(at("## Memory")).toBeGreaterThan(at(note));
  expect(instructions).toContain(`<core-profile>\n${profile}\n</core-profile>`);
  expect(instructions).not.toContain("Cut here");
  expect(at(PAGE_POINTER)).toBeGreaterThan(at("</core-profile>"));
  expect(at(MINI_POINTER)).toBeGreaterThan(at(PAGE_POINTER));
  expect(instructions).toContain("::next{reply=\"…\" btw=\"…\" do=\"…\"}");
  expect(instructions).toContain("Quick replies to prefer: 👍 Looks good | 🔁 Try another way | ❓ Explain more.");
  expect(instructions.endsWith("Studio kinds: designs are off, don't offer them.")).toBe(true);
});

it("keeps each pointer to one or two lines and says which end-of-reply attributes are on", () => {
  const pointers = [PAGE_POINTER, MINI_POINTER, endOfReplyPointer({ next: true, explore: true, replies: DEFAULT_REPLIES })!, endOfReplyPointer({ next: false, explore: true, replies: null })!];
  for (const pointer of pointers) {
    expect(pointer).not.toContain("\n");
    expect(pointer.length).toBeLessThanOrEqual(320);
  }
  expect(endOfReplyPointer({ next: true, explore: false, replies: null })).toBe('When a reply has next steps, end it with one ::next{do="…"} line; load the studio skill ("The Next row") for its rules before you write one. No reply= (quick replies are off).');
  expect(endOfReplyPointer({ next: false, explore: true, replies: [] })).toContain("::explore{items=");
  expect(endOfReplyPointer({ next: false, explore: false, replies: [] })).toBeNull();
  expect(studioInstructions({ bot: "", conversation: "", runner: "", pages: false, minis: false, endOfReply: null, routing: "" })).toBe("\u0000studio-memory\u0000");
  expect(BUILTIN_KINDS.length).toBeGreaterThan(0);
});

it("moves the long guidance into the studio skill, which the pointers name", () => {
  const skill = readFileSync(new URL("../skills/studio/SKILL.md", import.meta.url), "utf8");
  expect(skill).toMatch(/^---\nname: studio\n/);
  for (const heading of ["## Agent guide", "### Pages", "### Mini apps", "### The Next row", "### Explore", "### Kinds"]) expect(skill).toContain(heading);
  // The rules that were in every session's instructions.
  for (const rule of ["```chart", "replace_all only when asked", "sandboxed iframe", "pages_comment_reply", "minis_update", "one stray \" breaks the whole line", "“curly” quotes", "Don't also write ::reactions or ::explore lines", "1 to 4 items separated by |"]) expect(skill).toContain(rule);
});
