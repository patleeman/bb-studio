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
let registeredNames: Set<string>;
let callRpc: (method: string, input: unknown, options?: unknown) => Promise<unknown>;

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
  const host = createFakePluginHost({ pluginId: "studio", sdk: { threads: { list: async () => [], get: async ({ threadId }: { threadId: string }) => thread(threadId) }, projects: { list: async () => [] }, providers: { catalog: async () => [{ id: "acp-opencode", displayName: "OpenCode" }, { id: "codex", displayName: "Codex" }] } } } as never);
  await plugin(host.bb);
  configure = host.harness.registrations.agentConfigurationProvider as unknown as Configure;
  const registered = (host.harness.registrations as unknown as { agentTools: Tool[] }).agentTools;
  tools = new Map(registered.map((tool) => [tool.name, tool]));
  registeredNames = new Set(registered.map((tool) => tool.name));
  callRpc = (method, input, options) => (host.harness as unknown as { callRpc(method: string, input: unknown, options?: unknown): Promise<unknown> }).callRpc(method, input, options);
  // The Bot whose Main the test threads stand in for (a fresh install's, or one seeded here).
  const db = host.bb.storage.database() as unknown as { prepare(sql: string): { get(): { id: string } | undefined; run(...args: unknown[]): unknown } };
  if (!db.prepare("SELECT id FROM bots LIMIT 1").get()) db.prepare("INSERT INTO bots (id, name, avatar, state, created_at, updated_at) VALUES ('bot_main', 'Chief', 'C', 'active', 1, 1)").run();
  botId = db.prepare("SELECT id FROM bots LIMIT 1").get()!.id;
  // One thread of each kind: a worker of the Bot, a project's lead, a runner.
  db.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, source, created_at, updated_at) VALUES ('thr_kind_worker', ?, 'worker', 0, 'created', 1, 1)").run(botId);
  db.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('proj_other', 'thr_kind_lead', 1, 1)").run();
  db.prepare("INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, created_at, updated_at) VALUES ('run_t', ?, 'Inbox', 'Read the inbox.', 'thr_kind_runner', 'proj_personal', 'active', 'daily', '09:00', 1, 1)").run(botId);
  dispose = () => host.harness.lifecycle.dispose();
});
afterAll(() => dispose());

describe("configure() by provider", () => {
  it("a Bot's Main: every tool for Claude Code, loaded tools plus the trio for an ACP agent, a short list when lean", () => {
    const main = (provider: string, model: string) => configure(context("thr_main", provider, model, { metadata: { bot: botId } }));
    const claude = main("claude-code", "claude-opus-5-5");
    const acp = main("acp-opencode", "opencode-go/glm-5.3");
    const lean = main("acp-opencode", "inkling-local/inkling-2-mini");
    expect(names(claude.tools)).toContain("design_screen");
    expect(names(claude.tools)).not.toContain("design_write_screen");
    expect(names(claude.tools)).not.toContain("studio_tool_search");
    expect(names(acp.tools)).toEqual(expect.arrayContaining(["studio_tool_search", "studio_tool_describe", "studio_tool_call", "pages_edit", "memory", "schedule", "bot_info"]));
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
    expect(memory.tools[0]!.id).toBe("memory");
    // An old name finds its merged tool too ("Replaces memory_add" in its description).
    const byOldName = JSON.parse(await run("studio_tool_search", { query: "automation_create" }, thread)) as { tools: { id: string }[] };
    expect(byOldName.tools[0]!.id).toBe("schedule");
    const described = JSON.parse(await run("studio_tool_describe", { ids: ["pages_create", "memory", "memory_add", "nope"] }, thread)) as { tools: { id: string; inputSchema: unknown; replacedBy?: string }[]; notFound: string[] };
    expect(described.tools.map((tool) => tool.id)).toEqual(["pages_create", "memory", "memory_add"]);
    expect(described.tools[2]!.replacedBy).toBe('memory { op: "add" }');
    expect(JSON.stringify(described.tools[1]!.inputSchema)).toContain("Needs: ");
    expect(described.notFound).toEqual(["nope"]);
  });

  it("runs them with their own checks", async () => {
    const page = await run("studio_tool_call", { id: "pages_create", args: { title: "Lean test", markdown: "Hello" } }, thread);
    expect(page).toMatch(/pg_/);
    const memory = await run("studio_tool_call", { id: "memory", args: { op: "add", topic: "Preferences", text: "Prefers short replies." } }, thread);
    expect(memory).not.toMatch(/can't take that|isn't available|error/i);
    // The old name still works for one release.
    const old = await run("studio_tool_call", { id: "memory_add", args: { topic: "Preferences", text: "Likes lists." } }, thread);
    expect(old).not.toMatch(/can't take that|isn't available|error/i);
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

describe("every tool an instruction names is there", () => {
  const KINDS = [
    { kind: "main", thread: "thr_kind_main", metadata: () => ({ bot: botId }) },
    { kind: "conversation", thread: "thr_kind_conv", metadata: () => ({ botConversation: botId }) },
    { kind: "lead", thread: "thr_kind_lead", metadata: () => ({}) },
    { kind: "worker", thread: "thr_kind_worker", metadata: () => ({}) },
    { kind: "runner", thread: "thr_kind_runner", metadata: () => ({}) },
  ];
  const MODES = [
    { mode: "ACP", provider: "acp-opencode", model: "opencode-go/glm-5.3" },
    { mode: "ACP lean", provider: "acp-opencode", model: "inkling-local/inkling-2-mini" },
    { mode: "Claude Code", provider: "claude-code", model: "claude-opus-5-5" },
    { mode: "Codex", provider: "codex", model: "gpt-5.5" },
  ];
  for (const { kind, thread, metadata } of KINDS) for (const { mode, provider, model } of MODES) {
    it(`${kind}, ${mode}: loaded, or reachable through studio_tool_*`, async () => {
      const id = `${thread}_${provider}_${model.length}`;
      if (kind === "worker" || kind === "lead" || kind === "runner") {
        // Kind is read by thread id; reuse the seeded thread, one provider at a time.
        await configureAndCheck(thread, provider, model, metadata(), kind);
      } else {
        await configureAndCheck(id, provider, model, metadata(), kind);
      }
    });
  }

  async function configureAndCheck(threadId: string, provider: string, model: string, metadata: Record<string, unknown>, kind: string) {
    const result = configure(context(threadId, provider, model, { metadata }));
    const loaded = new Set(names(result.tools));
    const named = [...new Set(result.instructions.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [])].filter((name) => registeredNames.has(name));
    expect(named.length, `${kind} names some tools`).toBeGreaterThan(0);
    const missing = named.filter((name) => !loaded.has(name));
    if (missing.length) {
      expect(loaded.has("studio_tool_call"), `${kind} on ${provider} names ${missing.join(", ")} without loading them or the trio`).toBe(true);
      const described = JSON.parse(await run("studio_tool_describe", { ids: missing.slice(0, 8) }, threadId)) as { notFound: string[] };
      expect(described.notFound, `${kind} on ${provider}: named but unreachable`).toEqual([]);
      if (missing.length > 8) {
        const rest = JSON.parse(await run("studio_tool_describe", { ids: missing.slice(8, 16) }, threadId)) as { notFound: string[] };
        expect(rest.notFound).toEqual([]);
      }
      expect(result.instructions).toContain('call studio_tool_call { id: "<that name>", args }');
    }
    if (model.includes("local")) expect(result.instructions).not.toMatch(/studio skill/);
    if (provider === "acp-opencode" && !model.includes("local")) {
      // The thread really is that kind: its loaded tools say so.
      const signature: Record<string, [string[], string[]]> = {
        main: [["schedule", "design_screen", "strand_note", "memory", "bot_info"], ["automation_create", "design_write_screen"]],
        conversation: [["strand_note", "bot_info"], ["schedule"]],
        lead: [["strand_note", "pages_edit"], ["bot_info"]],
        worker: [["pages_create", "memory"], ["strand_note", "bot_info"]],
        runner: [["runner_report", "pages_read", "memory"], ["strand_note", "pages_create"]],
      };
      const [has, lacks] = signature[kind]!;
      for (const name of has) expect(loaded.has(name), `${kind} loads ${name}`).toBe(true);
      for (const name of lacks) expect(loaded.has(name), `${kind} doesn't load ${name}`).toBe(false);
    }
    if (kind === "runner") expect(result.instructions).not.toContain("strand_note");
    if (kind === "lead") expect(loaded.has("strand_note")).toBe(true);
  }
});

describe("Settings › Agent context changes", () => {
  const appWindow = { experimental_caller: { kind: "client", studioAppWindow: true } };
  it("refuses a change from anywhere but BB Studio's app window, and an unknown provider", async () => {
    await expect(callRpc("contextLean.set", { providerId: "acp-opencode", mode: "lean" })).rejects.toThrow(/app/i);
    await expect(callRpc("contextLean.set", { providerId: "acp-made-up", mode: "lean" }, appWindow)).rejects.toThrow(/No provider/);
    const answer = await callRpc("contextLean.set", { providerId: "acp-opencode", mode: "lean" }, appWindow) as { providers: { id: string; mode: string }[] };
    expect(answer.providers.find((row) => row.id === "acp-opencode")?.mode).toBe("lean");
    await callRpc("contextLean.set", { providerId: "acp-opencode", mode: "auto" }, appWindow);
    const read = await callRpc("contextLean.get", null) as { providers: { id: string; mode: string }[] };
    expect(read.providers.find((row) => row.id === "acp-opencode")?.mode).toBe("auto");
  });
});

describe("after Studio reloads mid-session", () => {
  it("works a thread's scope out again from the thread itself (its provider, model and title)", async () => {
    const found = JSON.parse(await run("studio_tool_search", { query: "design" }, "thr_reloaded_session")) as { tools: { id: string }[]; total: number };
    expect(found.total).toBeGreaterThan(0);
    expect(found.tools.map((tool) => tool.id)).toContain("design_screen");
  });
});

describe("merged tools run only the ops the thread may use", () => {
  it("refuses a worker's bot_info and schedule calls, and a lead's history view, through the merged tool", async () => {
    configure(context("thr_kind_worker", "acp-opencode", "glm", {}));
    expect(await run("schedule", { op: "list" }, "thr_kind_worker")).toMatch(/isn't available in this thread/);
    configure(context("thr_kind_lead", "acp-opencode", "glm", {}));
    expect(await run("bot_info", { view: "history", query: "x" }, "thr_kind_lead")).toMatch(/isn't available in this thread/);
  });

  it("names the valid ops and their fields for a bad op", () => {
    // BB checks a call with the tool's own schema before it runs; this is the message the agent gets.
    const schedule = tools.get("schedule") as unknown as { parse(input: unknown): { ok: boolean; error?: string } };
    const bad = schedule.parse({ op: "wat" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/op must be one of: list; create \(needs kind, name, schedule\)/);
    const missing = schedule.parse({ op: "create", kind: "checkin" });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/name/);
  });
});
