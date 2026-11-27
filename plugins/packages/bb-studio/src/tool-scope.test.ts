import { describe, expect, it } from "vitest";
import { DEFER_LOADING_KEY, DEFER_NAMESPACE, LEAN_LOADED, LOADED, scopeEntries, scopeTools, searchScoped, TRIO_TOOLS, trioInstructions, type ScopeKind } from "./tool-scope";

// A conversation's full list, as Studio's configure() builds it.
const CONVERSATION_FULL = [
  "pages_list", "pages_read", "pages_create", "pages_edit", "pages_comments",
  "design_save_style", "design_styles", "design_rename", "design_ask", "design_ready", "design_write_screen", "design_edit_screen", "design_comments", "design_resolve_comments",
  "talk_list", "talk_read", "talk_search", "talk_make_notes", "whiteboard_update", "minis_update", "minis_data",
  "apps_list", "apps_read", "apps_create", "apps_live",
  "code_workspace_open", "code_editor_state", "code_show", "code_edit", "code_comments", "code_comment_reply",
  "workbench_list", "workbench_open", "workbench_tab", "workbench_arrange",
  "bot_get", "bot_profile_update", "bot_state", "bot_activity", "strand_note", "area_update", "area_list", "area_get",
  "bot_skill_list", "bot_skill_view", "bot_skill_edit", "bot_skill_lint", "bot_history_search", "runner_migrate",
  "automation_list", "automation_create", "automation_update", "automation_pause", "automation_resume", "automation_run_now", "automation_delete",
  "bot_conversations", "bot_needs_you", "bot_activity_lookup", "bot_finish_done", "conversation_continue_new", "theme", "presence",
];
const scope = (kind: ScopeKind, providerId: string, options: { lean?: boolean; defer?: boolean; full?: string[] } = {}) =>
  scopeTools({ kind, full: options.full ?? CONVERSATION_FULL, providerId, lean: options.lean ?? false, deferSupported: options.defer ?? false });
const NONE = { slim: () => null, schema: () => ({ type: "object" }) };
const names = (entries: ReturnType<typeof scopeEntries>) => entries.map((entry) => (typeof entry === "string" ? entry : entry.name));

describe("tool scope by thread kind", () => {
  it("loads each kind's own tools and offers the rest on demand", () => {
    const conversation = scope("conversation", "acp-opencode");
    expect(conversation.loaded).toEqual(CONVERSATION_FULL.filter((name) => LOADED.conversation.includes(name)));
    expect(conversation.loaded).toHaveLength(11);
    expect(conversation.onDemand).toContain("design_write_screen");
    expect(conversation.onDemand).not.toContain("pages_edit");
  });

  it("keeps a worker away from the Bot's, the user's screen and strands tools, even on demand", () => {
    const worker = scope("worker", "acp-opencode");
    expect(worker.loaded).toEqual(["pages_read", "pages_create", "pages_edit"]);
    for (const name of ["bot_get", "bot_conversations", "automation_create", "area_update", "code_show", "workbench_open", "theme", "strand_note"]) expect(worker.onDemand).not.toContain(name);
    expect(worker.onDemand).toEqual(expect.arrayContaining(["design_write_screen", "apps_create", "talk_read", "pages_comments"]));
  });

  it("gives a runner runner_report and two page tools, and the rest of its allowed set on demand", () => {
    const runner = scope("runner", "acp-opencode", { full: [...CONVERSATION_FULL, "runner_report"] });
    expect([...runner.loaded].sort()).toEqual(["pages_edit", "pages_read", "runner_report"]);
    expect(runner.delivery).toBe("trio");
    expect(runner.onDemand).toEqual(expect.arrayContaining(["pages_create", "design_write_screen", "apps_create", "talk_read", "area_update"]));
    for (const name of ["strand_note", "bot_get", "bot_conversations", "automation_create", "code_show", "workbench_open", "theme"]) expect(runner.onDemand).not.toContain(name);
  });

  it("gives a classifier nothing", () => {
    const classifier = scope("classifier", "codex");
    expect(classifier).toMatchObject({ loaded: [], onDemand: [], delivery: "none" });
  });

  it("loads design and code_show in Main, where they're used most", () => {
    expect(scope("main", "acp-opencode").loaded).toEqual(expect.arrayContaining(["design_write_screen", "design_edit_screen", "code_show", "automation_create", "bot_skill_view"]));
  });
});

describe("delivery by provider", () => {
  it("Claude Code gets every tool: it defers MCP tools itself", () => {
    const claude = scope("conversation", "claude-code");
    expect(claude.delivery).toBe("all");
    expect(names(scopeEntries(claude, NONE))).toHaveLength(CONVERSATION_FULL.length);
  });

  it("Codex marks the on-demand tools `defer` when BB supports it, else uses the trio", () => {
    const deferred = scopeEntries(scope("conversation", "codex", { defer: true }), NONE);
    const marked = deferred.filter((entry) => typeof entry === "object" && entry.parameters[DEFER_LOADING_KEY] === DEFER_NAMESPACE);
    expect(marked).toHaveLength(CONVERSATION_FULL.length - 11);
    expect(marked[0]).toEqual({ name: expect.any(String), parameters: { type: "object", [DEFER_LOADING_KEY]: "studio" } });
    expect(names(deferred)).not.toEqual(expect.arrayContaining([...TRIO_TOOLS]));
    expect(names(scopeEntries(scope("conversation", "codex"), NONE))).toEqual(expect.arrayContaining([...TRIO_TOOLS]));
  });

  it("Pi and ACP agents get the loaded tools plus the trio", () => {
    for (const provider of ["pi", "acp-opencode", "acp-antigravity-acp", "antigravity"]) {
      const entries = names(scopeEntries(scope("conversation", provider), NONE));
      expect(entries).toEqual([...LOADED.conversation.filter((name) => CONVERSATION_FULL.includes(name)).sort((a, b) => CONVERSATION_FULL.indexOf(a) - CONVERSATION_FULL.indexOf(b)), ...TRIO_TOOLS]);
    }
  });

  it("lean keeps only what a turn needs, on every provider", () => {
    for (const provider of ["claude-code", "codex", "acp-opencode"]) {
      expect(names(scopeEntries(scope("conversation", provider, { lean: true, defer: true }), NONE))).toEqual(["strand_note", ...TRIO_TOOLS]);
      expect(names(scopeEntries(scope("worker", provider, { lean: true }), NONE))).toEqual([...TRIO_TOOLS]);
    }
    expect(LEAN_LOADED.runner).toEqual(["runner_report"]);
    // A lean runner still reaches the page tools it uses, through the trio.
    const runner = scope("runner", "acp-opencode", { lean: true, full: [...CONVERSATION_FULL, "runner_report"] });
    expect(runner).toMatchObject({ loaded: ["runner_report"], delivery: "trio" });
    expect(runner.onDemand).toEqual(expect.arrayContaining(["pages_edit", "pages_read", "pages_create"]));
    expect(runner.onDemand).not.toContain("strand_note");
  });

  it("folds Tool Gateway's trio into Studio's when the trio is used, and leaves it alone otherwise", () => {
    const full = [...CONVERSATION_FULL, "tool_gateway_search", "tool_gateway_describe", "tool_gateway_call"];
    const acp = scope("conversation", "acp-opencode", { full });
    expect(acp.gateway).toBe(true);
    expect(names(scopeEntries(acp, NONE)).filter((name) => name.startsWith("tool_gateway_"))).toEqual([]);
    expect(trioInstructions(acp.onDemand, acp.gateway)).toContain("your MCP servers");
    const claude = scope("conversation", "claude-code", { full });
    expect(claude.gateway).toBe(false);
    expect(names(scopeEntries(claude, NONE))).toEqual(expect.arrayContaining(["tool_gateway_search", "tool_gateway_call"]));
  });

  it("shows a slimmed schema through `parameters`", () => {
    const entries = scopeEntries(scope("conversation", "acp-opencode"), { slim: (name: string) => (name === "pages_edit" ? { type: "object" } : null), schema: () => null });
    expect(entries).toContainEqual({ name: "pages_edit", parameters: { type: "object" } });
    expect(entries).toContain("pages_read");
  });
});

describe("the trio's helpers", () => {
  it("names the groups it reaches", () => {
    expect(trioInstructions(["design_ask", "apps_create", "talk_read"])).toBe('Studio tools (designs, apps, recordings): find one with studio_tool_search, read its input with studio_tool_describe, then run it by id with studio_tool_call. Any Studio tool named in your instructions, skills or this chat\'s context that isn\'t in your tool list: call studio_tool_call { id: "<that name>", args } (studio_tool_describe { ids: ["<that name>"] } for its input).');
  });

  it("ranks name matches first and lists everything for an empty query", () => {
    const tools = [
      { name: "pages_create", description: "Create a BB Page from Markdown. More text." },
      { name: "memory_add", description: "Add a memory record." },
      { name: "apps_create", description: "Create an app; a page can embed it." },
    ];
    expect(searchScoped(tools, "page create").map((tool) => tool.name)).toEqual(["pages_create", "apps_create"]);
    expect(searchScoped(tools, "memory")[0]).toEqual({ id: "memory_add", name: "memory_add", summary: "Add a memory record." });
    expect(searchScoped(tools, "")).toHaveLength(3);
  });
});
