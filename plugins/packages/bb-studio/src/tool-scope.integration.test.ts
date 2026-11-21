// Studio's configure() and the studio_tool_* trio on the real plugin, in the
// SDK's fake host: what each provider's session gets, and that a lean session
// on a local model finds and runs pages_create and memory_add through search.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import plugin from "../server";

type Entry = string | { name: string; defer?: true; parameters?: unknown };
type Configure = (context: unknown) => { tools: Entry[]; skills: string[]; instructions: string };
type Tool = { name: string; execute(input: unknown, ctx: unknown): Promise<unknown> };

let configure: Configure;
let tools: Map<string, Tool>;
let dispose: () => Promise<void> = async () => {};
let botId: string;

const context = (threadId: string, providerId: string, model: string, extra: { title?: string | null; metadata?: Record<string, unknown> } = {}) => ({
  pluginMetadata: extra.metadata ?? {}, thread: { id: threadId, title: extra.title ?? null, parentThreadId: null, sourceThreadId: null },
  project: { id: "proj_personal", kind: "personal" as const, name: "Personal", gitRemoteUrl: null },
  environment: { id: "env", name: null, path: null, branchName: null, workspaceProvisionType: null },
  host: { id: "host", name: "host" }, provider: { id: providerId, model, capabilities: { supportsNativeUserQuestion: false } },
  origin: { kind: null, pluginId: null },
});
const names = (entries: Entry[]) => entries.map((entry) => (typeof entry === "string" ? entry : entry.name));
const run = async (name: string, input: unknown, threadId: string) => {
  const result = await tools.get(name)!.execute(input, { threadId, projectId: "proj_personal", callId: "call_1" });
  return typeof result === "string" ? result : JSON.stringify(result);
};

beforeAll(async () => {
  const thread = (threadId: string) => ({ id: threadId, projectId: "proj_personal", environmentId: "env", providerId: "acp-opencode", title: null, status: "idle", parentThreadId: null, sourceThreadId: null, createdAt: 1, updatedAt: 1, archivedAt: null });
  const host = createFakePluginHost({ pluginId: "studio", sdk: { threads: { list: async () => [], get: async ({ threadId }: { threadId: string }) => thread(threadId) }, projects: { list: async () => [] } } } as never);
  await plugin(host.bb);
  configure = host.harness.registrations.agentConfigurationProvider as unknown as Configure;
  const registered = (host.harness.registrations as unknown as { agentTools: Tool[] }).agentTools;
  tools = new Map(registered.map((tool) => [tool.name, tool]));
  // The Bot whose Main the test threads stand in for (a fresh install's, or one seeded here).
  const db = host.bb.storage.database() as unknown as { prepare(sql: string): { get(): { id: string } | undefined; run(...args: unknown[]): unknown } };
  if (!db.prepare("SELECT id FROM bots LIMIT 1").get()) db.prepare("INSERT INTO bots (id, name, avatar, state, created_at, updated_at) VALUES ('bot_main', 'Chief', 'C', 'active', 1, 1)").run();
  botId = db.prepare("SELECT id FROM bots LIMIT 1").get()!.id;
  dispose = () => host.harness.lifecycle.dispose();
});
afterAll(() => dispose());

describe("configure() by provider", () => {
  it("a Bot's Main: every tool for Claude Code, loaded tools plus the trio for an ACP agent, a short list when lean", () => {
    const main = (provider: string, model: string) => configure(context("thr_main", provider, model, { metadata: { bot: botId } }));
    const claude = main("claude-code", "claude-opus-5-5");
    const acp = main("acp-opencode", "opencode-go/glm-5.3");
    const lean = main("acp-opencode", "inkling-local/inkling-2-mini");
    expect(names(claude.tools)).toContain("design_write_screen");
    expect(names(claude.tools)).not.toContain("studio_tool_search");
    expect(names(acp.tools)).toEqual(expect.arrayContaining(["studio_tool_search", "studio_tool_describe", "studio_tool_call", "pages_edit", "memory_add"]));
    expect(names(acp.tools).length).toBeLessThan(names(claude.tools).length);
    expect(names(lean.tools)).toEqual(["strand_note", "studio_tool_search", "studio_tool_describe", "studio_tool_call"]);
    expect(lean.skills).toEqual([]);
    expect(lean.instructions).toContain("studio_tool_search");
    expect(claude.instructions).not.toContain("studio_tool_search");
  });

  it("shows pages_edit a slimmed schema", () => {
    const entry = configure(context("thr_main", "acp-opencode", "glm", { metadata: { bot: botId } })).tools.find((each) => typeof each === "object" && each.name === "pages_edit");
    expect(entry).toMatchObject({ name: "pages_edit", parameters: { type: "object" } });
    expect(JSON.stringify(entry)).toContain("Needs: ");
  });

  it("gives a Studio Decisions classifier thread nothing", () => {
    expect(configure(context("thr_cls", "codex", "gpt", { title: "Studio Decisions · req_1" }))).toEqual({ tools: [], skills: [], instructions: "" });
  });
});

describe("a lean session finds and runs tools through search", () => {
  const thread = "thr_lean";
  beforeAll(() => { configure(context(thread, "acp-opencode", "inkling-local/inkling-2-mini", { metadata: { bot: botId } })); });

  it("finds pages_create and memory_add", async () => {
    const pages = JSON.parse(await run("studio_tool_search", { query: "create page" }, thread)) as { tools: { id: string }[] };
    expect(pages.tools[0]!.id).toBe("pages_create");
    const memory = JSON.parse(await run("studio_tool_search", { query: "memory add" }, thread)) as { tools: { id: string }[] };
    expect(memory.tools[0]!.id).toBe("memory_add");
    const described = JSON.parse(await run("studio_tool_describe", { ids: ["pages_create", "memory_add", "nope"] }, thread)) as { tools: { id: string; inputSchema: unknown }[]; notFound: string[] };
    expect(described.tools.map((tool) => tool.id)).toEqual(["pages_create", "memory_add"]);
    expect(described.notFound).toEqual(["nope"]);
  });

  it("runs them with their own checks", async () => {
    const page = await run("studio_tool_call", { id: "pages_create", args: { title: "Lean test", markdown: "Hello" } }, thread);
    expect(page).toMatch(/pg_/);
    const memory = await run("studio_tool_call", { id: "memory_add", args: { topic: "Preferences", text: "Prefers short replies." } }, thread);
    expect(memory).not.toMatch(/can't take that|isn't available|error/i);
    const bad = await run("studio_tool_call", { id: "pages_create", args: { title: 5 } }, thread);
    expect(bad).toMatch(/pages_create can't take that/);
  });

  it("also reaches a loaded tool, flagged as loaded", async () => {
    configure(context("thr_worker_acp", "acp-opencode", "glm", { metadata: {} }));
    const found = JSON.parse(await run("studio_tool_search", { query: "strand" }, thread)) as { tools: { id: string; loaded?: boolean }[] };
    expect(found.tools.find((tool) => tool.id === "strand_note")).toMatchObject({ loaded: true });
  });

  it("refuses a tool the thread's kind doesn't have", async () => {
    configure(context("thr_runner_like", "acp-opencode", "inkling-local/x", { title: "Studio Decisions · x" }));
    expect(await run("studio_tool_call", { id: "pages_create", args: { title: "x" } }, "thr_runner_like")).toMatch(/isn't available/);
  });
});
