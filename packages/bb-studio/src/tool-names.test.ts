// Every tool name an agent reads must be a tool Studio registers. Agents act
// on what their instructions, skills, tool descriptions and tool results say,
// so a name left over from a retired tool makes them call a tool that isn't
// there. This builds the registered list from the plugin itself and scans
// what Studio ships: skills, docs, and every string in its server and app code.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import plugin from "../server";
import { rpcContract } from "./public-contract";
import { VOICE_TOOL_ALIASES, VOICE_TOOLS } from "./voice/live/shared";

/**
 * Agent tools Studio no longer registers. Their handlers may live on inside
 * Studio (the ToolBook runs them for pages_* and apps_*), and some share a
 * name with an RPC, but no agent can call them. Add a name here when you
 * retire a tool.
 */
const RETIRED = [
  "artifacts_save", "artifacts_list", "artifacts_read", "artifacts_live",
  "minis_create", "minis_read", "minis_list", "minis_live",
  "design_list", "design_read", "design_create",
  "whiteboard_list", "whiteboard_get", "whiteboard_create",
  "excalidraw_create_drawing", "excalidraw_get_drawing", "excalidraw_list_drawings", "excalidraw_update_drawing",
  "work_card_create", "work_card_update", "work_card_get",
  "todos_add", "todos_list", "todos_get", "todos_update", "todos_act", "todos_fire", "todos_morning",
  "loops_add", "loops_list", "loops_get", "loops_update", "loops_act", "loops_fire", "loops_morning",
  "pages_comment", "pages_comment_reply", "pages_comment_resolve",
  "workbench_close", "workbench_focus", "workbench_pop_out",
  "theme_list", "theme_create", "theme_update", "theme_apply", "theme_delete",
  "presence_list", "presence_create", "presence_update", "presence_apply", "presence_delete",
  "bot_set", "bot_pause", "bot_resume", "bot_stop", "bot_threads_list",
  "skill_search", "bot_skill_write", "bot_skill_patch", "bot_skill_delete",
  "runner_create", "runner_update", "runner_pause", "runner_resume", "runner_run_now", "runner_delete", "runner_list",
] as const;

const root = join(__dirname, "..");
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

type Registered = { name: string; description: string; instructions?: string };
let tools: Registered[] = [];
let registered = new Set<string>();
let dispose: () => Promise<void> = async () => {};

beforeAll(async () => {
  const host = createFakePluginHost({ pluginId: "studio", sdk: { threads: { list: async () => [], get: async () => null }, projects: { list: async () => [] } } } as never);
  await plugin(host.bb);
  const agentTools = (host.harness.registrations as unknown as { agentTools: Map<string, Registered> | Registered[] }).agentTools;
  tools = [...(agentTools instanceof Map ? agentTools.values() : agentTools)];
  registered = new Set(tools.map((tool) => tool.name));
  dispose = () => host.harness.lifecycle.dispose();
});
afterAll(() => dispose());

/** A token's first word, when some Studio tool (registered or retired) starts with it: "pages" for pages_read. */
function toolPrefixes(): Set<string> {
  return new Set([...registered, ...RETIRED].map((name) => name.split("_")[0]!));
}

function files(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

/** The text of every string and template literal in a source file, with its line. */
function literals(path: string): { text: string; line: number }[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, false, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { text: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      out.push({ text: node.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const retired = new Set<string>(RETIRED);
const mentions = (text: string) => [...text.matchAll(SNAKE)].map((match) => match[0]);

describe("tool names agents read", () => {
  it("registers none of the retired tools", () => {
    expect(registered.size).toBeGreaterThan(70);
    expect(RETIRED.filter((name) => registered.has(name))).toEqual([]);
  });

  it("names only registered tools in tool descriptions and instructions", () => {
    const prefixes = toolPrefixes();
    const bad = tools.flatMap((tool) => mentions(`${tool.description}\n${tool.instructions ?? ""}`)
      .filter((name) => prefixes.has(name.split("_")[0]!) && !registered.has(name))
      .map((name) => `${tool.name}: ${name}`));
    expect(bad).toEqual([]);
  });

  it("names only registered tools in the skills Studio ships", () => {
    const prefixes = toolPrefixes();
    const skills = files(join(root, "skills"), (path) => path.endsWith(".md"));
    expect(skills.length).toBeGreaterThan(5);
    const bad = skills.flatMap((path) => readFileSync(path, "utf8").split("\n").flatMap((text, index) => mentions(text)
      .filter((name) => prefixes.has(name.split("_")[0]!) && !registered.has(name))
      .map((name) => `${relative(root, path)}:${index + 1} ${name}`)));
    expect(bad).toEqual([]);
  });

  it("names no retired tool in a prompt, result, hint or error in Studio's code", () => {
    const sources = [join(root, "server.ts"), ...files(join(root, "src"), (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !/\/(test|fixtures)\//.test(path))];
    // Studio's realtime voice agent has its own tools, some named like the retired ones.
    const voice = new Set<string>([...VOICE_TOOLS, ...Object.keys(VOICE_TOOL_ALIASES)]);
    const bad = sources.flatMap((path) => {
      const inVoice = relative(root, path).startsWith("src/voice/");
      return literals(path)
        // A literal that is only the name is code naming a handler, an RPC or a voice tool, not text an agent reads.
        .filter(({ text }) => !retired.has(text.trim()))
        .flatMap(({ text, line }) => mentions(text)
          .filter((name) => retired.has(name) && !(inVoice && voice.has(name)))
          .map((name) => `${relative(root, path)}:${line} ${name}`));
    });
    expect(bad).toEqual([]);
  }, 30_000); // It parses every source file; under the full suite's load that takes more than the default 5 s.

  it("names no retired tool in the docs, except RPCs of the same name", () => {
    const rpcs = new Set(Object.keys(rpcContract));
    const docs = [join(root, "README.md"), ...files(join(root, "docs"), (path) => path.endsWith(".md"))];
    const bad = docs.flatMap((path) => readFileSync(path, "utf8").split("\n").flatMap((text, index) => mentions(text)
      .filter((name) => retired.has(name) && !rpcs.has(name))
      .map((name) => `${relative(root, path)}:${index + 1} ${name}`)));
    expect(bad).toEqual([]);
  });
});
