// Which of Studio's tools a session loads, and how it reaches the rest.
//
// Each thread kind loads the tools it uses most (checked against real tool-call
// history, 14–21 Nov). The others stay reachable on demand:
// - Claude Code defers MCP tools behind its own tool search, so it gets them all
//   and loads each one's schema only when it needs it.
// - Codex defers the on-demand ones when BB supports it
//   (experimental_hooks.experimental_features.deferredAgentTools): each one's
//   `parameters` override carries the JSON Schema vendor key
//   `x-bb-defer-loading: "studio"`, which BB's Codex bridge turns into
//   deferLoading inside a "studio" namespace.
// - Every other provider, and any provider in lean mode, gets the loaded tools
//   plus three tools to reach the rest: studio_tool_search, studio_tool_describe
//   and studio_tool_call, the same search → describe → call shape as Tool
//   Gateway's. They also reach Tool Gateway's MCP tools, so a session has one
//   trio, not two.
// - Lean (Settings › Agent context) keeps only what a turn can't work without
//   (LEAN_LOADED) and puts everything else behind the trio.
// A Decisions classifier thread gets nothing of Studio's.

export type ScopeKind = "main" | "conversation" | "lead" | "worker" | "runner" | "classifier";

export const TRIO_TOOLS = ["studio_tool_search", "studio_tool_describe", "studio_tool_call"] as const;
const GATEWAY_TRIO = ["tool_gateway_search", "tool_gateway_describe", "tool_gateway_call"];
const TRIO = new Set<string>(TRIO_TOOLS);

const PAGES = ["pages_list", "pages_read", "pages_create", "pages_edit", "pages_comments"];
const CONVERSATION = ["bot_conversations", "bot_needs_you", "bot_activity_lookup", "bot_finish_done", "conversation_continue_new"];
const BOT = ["bot_get", "bot_profile_update", "bot_state", "bot_activity"];
const BOT_OWN = ["bot_skill_list", "bot_skill_view", "bot_skill_edit", "bot_skill_lint", "bot_history_search", "runner_migrate", "automation_list", "automation_create", "automation_update", "automation_pause", "automation_resume", "automation_run_now", "automation_delete"];
const AREA = ["area_update", "area_list", "area_get"];
const DESIGN = ["design_save_style", "design_styles", "design_rename", "design_ask", "design_ready", "design_write_screen", "design_edit_screen", "design_comments", "design_resolve_comments"];
const CODE = ["code_workspace_open", "code_editor_state", "code_show", "code_edit", "code_comments", "code_comment_reply"];
const WORKBENCH = ["workbench_list", "workbench_open", "workbench_tab", "workbench_arrange"];
const LOOKS = ["theme", "presence"];

/** Tools each kind loads up front (those the kind has; a kind turned off in Setup stays off). */
export const LOADED: Record<ScopeKind, readonly string[]> = {
  // Main: design 114 calls and code_show 34 in a week, so they load here.
  main: [...PAGES, "strand_note", ...CONVERSATION, ...BOT, ...BOT_OWN, ...AREA, ...DESIGN, "code_show"],
  conversation: [...PAGES, "strand_note", ...CONVERSATION],
  lead: [...PAGES, "strand_note"],
  worker: ["pages_read", "pages_create", "pages_edit"],
  runner: ["runner_report", "pages_read", "pages_edit"],
  classifier: [],
};

/** Lean mode: what stays loaded; everything else is on demand through the trio. */
export const LEAN_LOADED: Record<ScopeKind, readonly string[]> = {
  main: ["strand_note"],
  conversation: ["strand_note"],
  lead: ["strand_note"],
  worker: [],
  runner: ["runner_report"],
  classifier: [],
};

/** Tools a kind never gets, not even on demand. */
const NEVER: Record<ScopeKind, readonly string[] | "all"> = {
  main: [],
  conversation: [],
  lead: [...BOT_OWN, ...LOOKS],
  worker: [...CONVERSATION, ...BOT, ...BOT_OWN, ...AREA, ...CODE, ...WORKBENCH, ...LOOKS, "strand_note"],
  // A runner's job is free text: it reaches pages, designs, apps, recordings and memory on demand, never the user's screen or the Bot's own tools.
  runner: [...CONVERSATION, ...BOT, ...BOT_OWN, ...CODE, ...WORKBENCH, ...LOOKS, "strand_note"],
  classifier: "all",
};

/** Studio tools no session loads, offered on demand (descriptions point to them). */
export const ON_DEMAND_EXTRAS = ["studio_tag_items"] as const;

export const DEFER_LOADING_KEY = "x-bb-defer-loading";
/** The Codex namespace Studio's deferred tools go in (Codex takes deferred tools only inside one). */
export const DEFER_NAMESPACE = "studio";

/** How a provider's sessions get the on-demand tools, per provider (src/tool-delivery.ts); "default" is the built-in choice. */
export type ToolDeliveryMode = "default" | "all" | "defer" | "trio";

export type ToolEntry = string | { name: string; parameters: Record<string, unknown> };

export interface Scope {
  kind: ScopeKind;
  loaded: string[];
  onDemand: string[];
  /** How the on-demand tools reach the agent. */
  delivery: "all" | "defer" | "trio" | "none";
  /** The trio also reaches Tool Gateway's MCP tools (its own three aren't loaded). */
  gateway: boolean;
}

/**
 * Splits the tools a session would get (`full`, in order) into loaded and on
 * demand for its kind, and picks the delivery for its provider.
 */
export function scopeTools(input: { kind: ScopeKind; full: readonly string[]; providerId: string; lean: boolean; deferSupported: boolean; extras?: readonly string[]; delivery?: ToolDeliveryMode }): Scope {
  const never = NEVER[input.kind];
  const loadedSet = new Set(input.lean ? LEAN_LOADED[input.kind] : LOADED[input.kind]);
  const pool = [...new Set([...input.full, ...(input.extras ?? [])])].filter((name) => !TRIO.has(name));
  // Tool Gateway's own trio stays as it is unless Studio's trio takes it over.
  const gatewayTools = pool.filter((name) => GATEWAY_TRIO.includes(name));
  const studio = pool.filter((name) => !GATEWAY_TRIO.includes(name));
  const loaded = studio.filter((name) => loadedSet.has(name));
  // Lean: what the kind loads in full mode stays reachable through the trio, even for a runner.
  const fullLoaded = new Set(LOADED[input.kind]);
  const onDemand = studio.filter((name) => !loadedSet.has(name) && (input.lean && fullLoaded.has(name) || (never !== "all" && !never.includes(name))));
  const base = { kind: input.kind, onDemand };
  if (onDemand.length === 0) return { ...base, loaded: [...loaded, ...gatewayTools], delivery: "none", gateway: false };
  // The provider's setting (src/tool-delivery.ts), else Claude Code loads every tool and Codex defers them.
  const chosen = input.delivery && input.delivery !== "default" ? input.delivery : input.providerId === "claude-code" ? "all" : input.providerId === "codex" ? "defer" : "trio";
  if (!input.lean && chosen === "all") return { ...base, loaded: [...loaded, ...gatewayTools], delivery: "all", gateway: false };
  if (!input.lean && chosen === "defer" && input.deferSupported) return { ...base, loaded: [...loaded, ...gatewayTools], delivery: "defer", gateway: false };
  return { ...base, loaded, delivery: "trio", gateway: gatewayTools.length > 0 };
}

/**
 * The entries for configure(): loaded first, then the on-demand ones as the
 * delivery says. `slim` is the smaller schema to show (null: as registered);
 * `schema` the one a deferred tool carries its marker on (slim or registered).
 */
export function scopeEntries(scope: Scope, shown: { slim(name: string): Record<string, unknown> | null; schema(name: string): Record<string, unknown> | null }): ToolEntry[] {
  const entry = (name: string): ToolEntry => {
    const parameters = shown.slim(name);
    return parameters ? { name, parameters } : name;
  };
  const deferred = (name: string): ToolEntry => {
    const schema = shown.schema(name);
    return schema ? { name, parameters: { ...schema, [DEFER_LOADING_KEY]: DEFER_NAMESPACE } } : name;
  };
  const loaded = scope.loaded.map(entry);
  switch (scope.delivery) {
    case "all": return [...loaded, ...scope.onDemand.map(entry)];
    case "defer": return [...loaded, ...scope.onDemand.map(deferred)];
    case "trio": return [...loaded, ...TRIO_TOOLS];
    case "none": return loaded;
  }
}

const GROUP_LABELS: [RegExp, string][] = [
  [/^design(_|$)/, "designs"], [/^(apps|minis)(_|$)/, "apps"], [/^talk(_|$)/, "recordings"], [/^whiteboard(_|$)/, "whiteboards"],
  [/^code(_|$)/, "VS Code"], [/^workbench(_|$)/, "the workbench"], [/^(schedule|automation_|runner_migrate)/, "schedules"], [/^(bot_skill|bot_history)/, "skills and history"],
  [/^area(_|$)/, "areas"], [/^(theme|presence)$/, "themes"], [/^bot_/, "the Bot"], [/^pages_/, "pages"], [/^studio_tag/, "tags"],
];

/** One line telling the agent what it can reach through the trio. */
export function trioInstructions(onDemand: readonly string[], gateway = false): string {
  const groups = [...new Set(onDemand.map((name) => GROUP_LABELS.find(([pattern]) => pattern.test(name))?.[1]).filter((label): label is string => !!label))];
  if (gateway) groups.push("your MCP servers");
  return `Studio tools (${groups.join(", ")}): find one with studio_tool_search, read its input with studio_tool_describe, then run it by id with studio_tool_call. Any Studio tool named in your instructions, skills or this chat's context that isn't in your tool list: call studio_tool_call { id: "<that name>", args } (studio_tool_describe { ids: ["<that name>"] } for its input).`;
}

/** Ranks on-demand tools for a query: name hits first, then description hits; empty lists all. */
export function searchScoped(tools: readonly { name: string; description: string }[], query: string | undefined, limit = 25): { id: string; name: string; summary: string }[] {
  const words = (query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const scored = tools.map((tool) => {
    const name = tool.name.toLowerCase();
    const text = tool.description.toLowerCase();
    // A query that is a whole tool name (an old one a merged tool replaces, too) ranks that tool first.
    const exact = query && /^[a-z0-9_]+$/i.test(query.trim()) && (name === query.trim().toLowerCase() || new RegExp(`\\b${query.trim().toLowerCase()}\\b`).test(text)) ? 10 : 0;
    const score = words.length === 0 ? 1 : exact + words.reduce((sum, word) => sum + (name.includes(word) ? 3 : 0) + (text.includes(word) ? 1 : 0), 0);
    return { tool, score };
  }).filter((each) => each.score > 0);
  scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return scored.slice(0, limit).map(({ tool }) => ({ id: tool.name, name: tool.name, summary: firstSentence(tool.description) }));
}

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = clean.search(/[.!?](\s|$)/);
  const sentence = end > 0 ? clean.slice(0, end + 1) : clean;
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
}
