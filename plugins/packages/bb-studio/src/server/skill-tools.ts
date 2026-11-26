import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { SKILL_NAME, type Bots } from "../bot";
import { opNeeds } from "../op-errors";
import { callText, clipLine, nextLine, pageByKey, pageText, staleCursor } from "../paging";
import { patchText, type SkillLearning } from "../skill-learning";

/** A skill body's part (bot_skill view): measured bodies run a median 4,800 characters, p90 13,600. */
const SKILL_PART_CHARS = 8_000;

export interface BotSkillToolsDeps {
  bb: BbPluginApi;
  bots: Bots;
  learning: SkillLearning;
  ownBot: (threadId: string | undefined) => string;
}

/** Registers the Bot's own skill tools (list, view, edit, lint). */
export function registerBotSkillTools({ bb, bots, learning, ownBot }: BotSkillToolsDeps): void {
  /** The lint's advisory notes, after a tool's result line. */
  const withNotes = (line: string, skill: { name: string; body: string; alwaysOn?: boolean }, botId: string) => {
    const notes = bots.skillLint(skill, botId);
    return notes.length ? `${line}\nNotes (advisory, nothing was blocked):\n${notes.map((note) => `- ${note}`).join("\n")}` : line;
  };
  const saveSkill = (input: { name: string; description: string; body: string; alwaysOn?: boolean }, botId: string, threadId: string | undefined, verb: string) => {
    bots.writeSkill(input, botId);
    learning.noteWrite(threadId, "saved");
    return withNotes(`${verb === "patched" ? "Patched" : "Saved"} your skill ${input.name}.`, input, botId);
  };

  bb.agents.registerTool({
    name: "bot_skill_lint",
    description: "Inspect saved skill versions and optionally attach advisory quality or safety warnings to an exact version. Never blocks or rolls back a save.",
    parameters: z.object({ versionId: z.number().int().positive().optional(), warnings: z.array(z.string().min(1).max(2000)).max(20).optional() }),
    execute: ({ versionId, warnings }, ctx) => {
      const botId = ownBot(ctx.threadId);
      if (versionId && warnings) bots.lintSkillVersion(versionId, warnings, botId);
      return JSON.stringify(bots.skillHistory(botId).slice(0, 20));
    },
  });

  bb.agents.registerTool({
    name: "bot_skill_list",
    description: "List or search your own skills (non-archived). Without query, lists all; with query, searches names, descriptions and full text (load one with bot_skill (op: view) before following it).",
    parameters: z.object({ query: z.string().trim().min(1).max(200).optional(), limit: z.number().int().min(1).max(20).optional(), after: z.string().min(1).max(512).optional().describe("The cursor the last part's Next names") }),
    execute: ({ query, limit, after }, ctx) => {
      const botId = ownBot(ctx.threadId);
      if (query) {
        const hits = bots.searchSkills(query, limit ?? 5, botId);
        if (!hits.length) return `No skill of yours matches "${query}".`;
        return hits.map((hit, index) => `${index + 1}. ${hit.name}: ${clipLine(hit.description, 200)} (matched ${hit.fields.join(", ")})${hit.snippet ? `\n   ${clipLine(hit.snippet, 200)}` : ""}`).join("\n");
      }
      const list = bots.skills(botId).filter((skill) => skill.state !== "archived");
      if (!list.length) return "No skills yet.";
      // In parts (src/paging.ts), descriptions on one short line.
      const rows = list.map((skill) => ({ id: skill.name, line: `- ${skill.name}${skill.pinned ? " (pinned)" : ""}${skill.state === "stale" ? " (stale)" : ""}: ${clipLine(skill.description, 200)}` }));
      // By keyset on (pinned first, name): reading or using a skill between parts doesn't move it.
      const keys = new Map(list.map((skill) => [skill.name, [skill.pinned ? 0 : 1, skill.name] as (string | number)[]]));
      const part = pageByKey(rows, (each) => keys.get(each.id)!, (each) => each.line.length, { after });
      if (part.missing) return staleCursor("That cursor", callText("bot_skill_list", {}));
      const next = nextLine(part, (last) => callText("bot_skill_list", { after: last }), "skills");
      return [`${list.length} skill${list.length === 1 ? "" : "s"}.`, ...(next ? [next] : []), ...part.items.map((each) => each.line)].join("\n");
    },
  });

  bb.agents.registerTool({
    name: "bot_skill_view",
    description: "Load one of your own skills in full, in parts of about 8,000 characters (the next part with offset, as the reply says). Do it before you follow a skill: your instructions list only names and descriptions.",
    parameters: z.object({ name: z.string().min(1).max(64), offset: z.number().int().min(0).optional().describe("Where the next part starts, as the last part's Next says") }),
    execute: ({ name, offset }, ctx) => {
      const botId = ownBot(ctx.threadId);
      const skill = bots.skill(name, botId);
      if (!skill || skill.state === "archived") return `No skill "${name}". Yours: ${bots.skills(botId).filter((each) => each.state !== "archived").map((each) => each.name).join(", ") || "none"}.`;
      // A review reading skills isn't the Bot using them.
      if (!learning.review(ctx.threadId) && !offset) bots.touchSkill(name, botId);
      const part = pageText(skill.body, offset ?? 0, SKILL_PART_CHARS);
      if (part.missing) return `The skill ${skill.name} is ${skill.body.length.toLocaleString("en-US")} characters now; ${offset} is past its end. Start again: ${callText("bot_skill_view", { name: skill.name })}.`;
      const next = part.next === null ? null : `(Characters ${(offset ?? 0).toLocaleString("en-US")}–${part.next.toLocaleString("en-US")} of ${skill.body.length.toLocaleString("en-US")}. Next: ${callText("bot_skill_view", { name: skill.name, offset: part.next })}.)`;
      return [`# ${skill.name}`, skill.description, ...(next ? [next] : []), "", part.text].join("\n");
    },
  });

  bb.agents.registerTool({
    name: "bot_skill_edit",
    description: 'Create, patch or delete one of your own skills. op "write": name (lowercase-with-hyphens), description, body. op "patch": name, find (exact text from bot_skill (op: view)), replace, all?, description?. op "delete": name.',
    parameters: z.object({
      op: z.enum(["write", "patch", "delete"]),
      name: z.string().min(1).max(64),
      description: z.string().trim().min(1).max(500).optional().describe("One sentence: when to use it"),
      body: z.string().min(1).max(20_000).optional().describe("write: Markdown instructions"),
      find: z.string().min(1).max(20_000).optional().describe("patch: exact text to replace"),
      replace: z.string().max(20_000).optional().describe("patch: replacement text (empty removes)"),
      all: z.boolean().optional().describe("patch: replace every occurrence"),
      alwaysOn: z.boolean().optional().describe("write: inject it in full into every prompt (keep always-on skills under 3,000 characters together); default keeps the skill's setting, on demand for a new one"),
    }),
    execute: ({ op, name, description, body, find, replace, all, alwaysOn }, ctx) => {
      const botId = ownBot(ctx.threadId);
      if (op === "delete") {
        const skill = bots.skill(name, botId);
        if (!skill) return `No skill "${name}".`;
        if (learning.review(ctx.threadId) && skill.pinned) return `${name} is pinned by the user; leave it.`;
        bots.deleteSkill(name, botId);
        learning.noteWrite(ctx.threadId, "saved");
        return `Deleted ${name}.`;
      }
      if (op === "patch") {
        const skill = bots.skill(name, botId);
        if (!skill) return `No skill "${name}". Make it with bot_skill (op: edit, change: "write").`;
        if (find === undefined || replace === undefined) return opNeeds("patch", ["name", "find", "replace"]);
        return saveSkill({ name, description: description ?? skill.description, body: patchText(skill.body, find, replace, all) }, botId, ctx.threadId, "patched");
      }
      if (!description || !body) return opNeeds("write", ["name", "description", "body"]);
      if (!SKILL_NAME.test(name)) return { content: [{ type: "text" as const, text: "Skill name must be lowercase-with-hyphens." }], isError: true as const };
      return saveSkill({ name, description, body, ...(alwaysOn === undefined ? {} : { alwaysOn }) }, botId, ctx.threadId, bots.skill(name, botId) ? "rewritten" : "new");
    },
  });
}
