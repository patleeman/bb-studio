// Studio's tools, combined by family (spec: "Studio tools: the full list, and
// what to combine"). A merged tool takes an `op` (bot_info: `view`) and runs
// the old tool's own handler with the old tool's own zod check, through the
// ToolBook. The old tools stay registered for one release as hidden aliases:
// never offered to a session, but studio_tool_call takes their names, and each
// merged tool's description lists the names it replaces so a tool search finds
// it by an old name.
//
// Two merges keep an existing name: pages_read also lists pages (no `page`)
// and works with comments (`comments`), and code_comments also replies
// (`op: "reply"`). Their old handlers move to internal names (INTERNAL_RENAMES).
//
// Tool scope (src/tool-scope.ts) keeps working in the old names; a session
// sees the merged names (presentScope), and a merged tool runs an op only when
// its old tool is in the thread's scope.
import { z } from "zod";

export interface Merge {
  name: string;
  /** The field that picks the operation. */
  field: "op" | "view";
  summary: string;
  /** op → the old tool it runs. */
  ops: Record<string, string>;
  /** An old tool's own field that clashes with `field`, renamed in the merged schema: op → { old → new }. */
  rename?: Record<string, Record<string, string>>;
}

export const MERGES: readonly Merge[] = [
  { name: "schedule", field: "op", summary: "The Bot's schedules: check-ins, reminders, watchers and runners", ops: { list: "automation_list", create: "automation_create", update: "automation_update", pause: "automation_pause", resume: "automation_resume", run_now: "automation_run_now", delete: "automation_delete" } },
  { name: "talk", field: "op", summary: "Talk recordings and their transcripts", ops: { list: "talk_list", read: "talk_read", search: "talk_search", make_notes: "talk_make_notes" } },
  { name: "bot_skill", field: "op", summary: "The Bot's skills", ops: { list: "bot_skill_list", view: "bot_skill_view", edit: "bot_skill_edit", lint: "bot_skill_lint" }, rename: { edit: { op: "change" } } },
  { name: "bot_info", field: "view", summary: "Read about the Bot and its threads", ops: { profile: "bot_get", state: "bot_state", activity: "bot_activity", conversations: "bot_conversations", thread: "bot_activity_lookup", history: "bot_history_search" } },
  { name: "area", field: "op", summary: "Areas: the user's ongoing domains and their status", ops: { list: "area_list", get: "area_get", update: "area_update" } },
  { name: "code", field: "op", summary: "VS Code beside the chat", ops: { open: "code_workspace_open", state: "code_editor_state", show: "code_show", edit: "code_edit" } },
  { name: "design_screen", field: "op", summary: "A design's screens", ops: { write: "design_write_screen", edit: "design_edit_screen", rename: "design_rename" } },
  { name: "design_review", field: "op", summary: "Questions, review and comments on a design", ops: { ask: "design_ask", ready: "design_ready", comments: "design_comments", resolve: "design_resolve_comments" } },
  { name: "design_style", field: "op", summary: "Saved design styles", ops: { save: "design_save_style", list: "design_styles" } },
  { name: "workbench", field: "op", summary: "The user's workbench: tabs and panes beside the chat", ops: { list: "workbench_list", open: "workbench_open", tab: "workbench_tab", arrange: "workbench_arrange" } },
  { name: "apps", field: "op", summary: "Apps: saved outputs and interactive mini apps", ops: { list: "apps_list", read: "apps_read", create: "apps_create", live: "apps_live", update: "minis_update" }, rename: { live: { op: "liveOp" } } },
];

/** Merges that keep an existing tool's name: their old handler's internal name, and op → old tool. */
export const INTERNAL_RENAMES: Readonly<Record<string, string>> = { pages_read: "pages_read_page", code_comments: "code_comments_list" };
const ABSORBS: Record<string, Record<string, string>> = {
  pages_read: { page: "pages_read", list: "pages_list", comments: "pages_comments" },
  code_comments: { list: "code_comments", reply: "code_comment_reply" },
};

/** Each old name → its merged tool and op. */
export const ALIASES: ReadonlyMap<string, { merged: string; op: string }> = new Map([
  ...MERGES.flatMap((merge) => Object.entries(merge.ops).map(([op, old]) => [old, { merged: merge.name, op }] as const)),
  ...Object.entries(ABSORBS).flatMap(([merged, ops]) => Object.entries(ops).filter(([, old]) => old !== merged).map(([op, old]) => [old, { merged, op }] as const)),
]);

/** The old names a merge replaces, for docs and the tool-names test. */
export const ALIASED_NAMES: ReadonlySet<string> = new Set(ALIASES.keys());

/** The name a session sees for an old name. */
export function presentedName(name: string): string {
  return ALIASES.get(name)?.merged ?? name;
}

/** The old tool a merged tool's op runs (the merged name itself for an absorb's own op). */
export function memberOf(merged: string, op: string): string | null {
  const merge = MERGES.find((each) => each.name === merged);
  if (merge) return merge.ops[op] ?? null;
  const absorbs = ABSORBS[merged];
  return absorbs?.[op] ?? null;
}

/** Whether a tool call (an event's item) ran this old tool: by its own name, or as its merged tool's op. */
export function callRuns(item: { tool?: string; name?: string; arguments?: unknown } | undefined, oldName: string): boolean {
  const name = item?.tool ?? item?.name ?? "";
  if (name === oldName) return true;
  const alias = ALIASES.get(oldName);
  if (!alias || name !== alias.merged) return false;
  const args = item?.arguments && typeof item.arguments === "object" ? item.arguments as Record<string, unknown> : {};
  const merge = MERGES.find((each) => each.name === alias.merged);
  if (merge) return args[merge.field] === alias.op;
  if (alias.merged === "pages_read") {
    if (alias.op === "list") return args.page === undefined && args.comments === undefined;
    if (alias.op === "comments") return args.page !== undefined && args.comments !== undefined;
  }
  if (alias.merged === "code_comments") {
    if (alias.op === "reply") return args.op === "reply";
  }
  return false;
}

/** For tool scope: loaded and on-demand old names → merged names, and the ops each merged tool may run. */
export function presentScope(scope: { loaded: readonly string[]; onDemand: readonly string[] }): { loaded: string[]; onDemand: string[]; ops: Map<string, string[]>; loadedOps: Map<string, string[]> } {
  const opsOf = (names: readonly string[]) => {
    const out = new Map<string, string[]>();
    for (const name of names) {
      const alias = ALIASES.get(name);
      const merged = alias?.merged ?? (ABSORBS[name] ? name : null);
      if (!merged) continue;
      const op = alias?.op ?? Object.entries(ABSORBS[name]!).find(([, old]) => old === name)![0];
      out.set(merged, [...(out.get(merged) ?? []), op]);
    }
    return out;
  };
  const loadedOps = opsOf(scope.loaded);
  const ops = new Map<string, string[]>();
  for (const name of [...scope.loaded, ...scope.onDemand]) {
    const alias = ALIASES.get(name);
    const merged = alias?.merged ?? (ABSORBS[name] ? name : null);
    if (!merged) continue;
    const op = alias?.op ?? Object.entries(ABSORBS[name]!).find(([, old]) => old === name)![0];
    ops.set(merged, [...(ops.get(merged) ?? []), op]);
  }
  const loaded = [...new Set(scope.loaded.map(presentedName))];
  const onDemand = [...new Set(scope.onDemand.map(presentedName))].filter((name) => !loaded.includes(name));
  return { loaded, onDemand, ops, loadedOps };
}

/** For an absorb (pages_read, code_comments): the fields each op adds, to leave out of a shown schema without that op. */
export const ABSORB_FIELDS: Readonly<Record<string, Record<string, readonly string[]>>> = {
  pages_read: { list: ["query", "type", "after"], comments: ["comments"] },
  code_comments: { reply: ["op", "id", "body", "resolve"] },
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/**
 * Cached resolver for a merged/absorbed tool's shown JSON Schema keyed by its
 * allowed op set. Null results are never cached, and cached schemas are deeply
 * frozen so callers cannot mutate shared state.
 */
export function createMergedShownCache(deps: {
  base(name: string): Record<string, unknown> | null;
  slim(schema: unknown): unknown;
  book: Book;
}): (name: string, ops: ReadonlyMap<string, string[]>) => Record<string, unknown> | null {
  const cache = new Map<string, Record<string, unknown>>();
  return (name, ops) => {
    const allowed = ops.get(name);
    if (!allowed) return null;
    const key = `${name}:${[...allowed].sort().join(",")}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const absorb = ABSORB_FIELDS[name];
    if (absorb) {
      // An absorb shows only its allowed ops' fields; without the list op, page is required.
      const base = deps.base(name);
      if (!base) return null;
      const drop = Object.entries(absorb).filter(([op]) => !allowed.includes(op)).flatMap(([, fields]) => fields);
      const properties = Object.fromEntries(Object.entries((base.properties ?? {}) as Record<string, unknown>).filter(([prop]) => !drop.includes(prop)));
      const required = name === "pages_read" && !allowed.includes("list") ? ["page"] : (base.required as string[] | undefined);
      const schema = deepFreeze({ ...base, properties, ...(required ? { required } : {}) });
      cache.set(key, schema);
      return schema;
    }

    const merge = MERGES.find((each) => each.name === name);
    if (!merge) return null;
    let schema: Record<string, unknown> | null = null;
    try {
      // Always flattened: BB takes a parameters override only with an object at its root, never a bare oneOf.
      const flat = deps.slim(mergedParameters(merge, deps.book, Object.keys(merge.ops).filter((op) => allowed.includes(op))).toJSONSchema()) as Record<string, unknown>;
      schema = flat && typeof flat === "object" && flat.type === "object" ? deepFreeze(flat) : null;
    } catch { /* Shown as registered. */ }
    if (schema) cache.set(key, schema);
    return schema;
  };
}

interface BookTool { name: string; description: string; parameters: z.ZodType; execute(input: never, ctx: never): unknown }
interface Book { get(name: string): BookTool | null; run(name: string, input: unknown, ctx: unknown, as?: string): Promise<unknown> }

const firstSentence = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = clean.search(/[.!?](\s|$)/);
  const sentence = end > 0 ? clean.slice(0, end) : clean;
  return sentence.length > 110 ? `${sentence.slice(0, 109)}…` : sentence;
};

/** The fields an object schema requires (not optional, no default). */
function requiredFields(schema: z.ZodType): string[] {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape ?? {};
  return Object.entries(shape).filter(([, field]) => !field.safeParse(undefined).success).map(([key]) => key);
}

function renamed(shape: Record<string, z.ZodType>, map: Record<string, string> | undefined): Record<string, z.ZodType> {
  if (!map) return shape;
  return Object.fromEntries(Object.entries(shape).map(([key, value]) => [map[key] ?? key, value]));
}

/** "list; create (needs kind, name, schedule); …" */
export function opsNote(merge: Merge, book: Book, ops: readonly string[] = Object.keys(merge.ops)): string {
  return ops.map((op) => {
    const tool = book.get(merge.ops[op]!);
    if (!tool) return op;
    const map = merge.rename?.[op] ?? {};
    const needs = requiredFields(tool.parameters).map((key) => map[key] ?? key);
    return needs.length ? `${op} (needs ${needs.join(", ")})` : op;
  }).join("; ");
}

/** The zod schema of a merge, for the given ops (all by default). */
export function mergedParameters(merge: Merge, book: Book, ops: readonly string[] = Object.keys(merge.ops)): z.ZodType {
  const variants = ops.flatMap((op) => {
    const tool = book.get(merge.ops[op]!);
    const shape = (tool?.parameters as unknown as { shape?: Record<string, z.ZodType> } | undefined)?.shape;
    if (!shape) return [];
    return [z.object({ [merge.field]: z.literal(op), ...renamed(shape, merge.rename?.[op]) })];
  });
  const note = `${merge.field} must be one of: ${opsNote(merge, book, ops)}.`;
  if (variants.length === 1) return variants[0]!;
  return z.discriminatedUnion(merge.field, variants as [z.ZodObject, z.ZodObject, ...z.ZodObject[]], { error: (issue) => (issue.code === "invalid_union" ? note : undefined) });
}

/** A merge's tool-level instructions: its members' own, each once. */
function instructionsOfWith(book: Book, merge: Merge): string | null {
  const texts = [...new Set(Object.values(merge.ops).map((old) => (book.get(old) as { instructions?: string } | null)?.instructions).filter((text): text is string => !!text))];
  return texts.length ? texts.join("\n\n") : null;
}

export interface MergedToolDeps {
  book: Book;
  /** Whether the calling thread may run this old tool (it is in the thread's scope). */
  allowed(ctx: unknown, oldName: string): Promise<boolean>;
}

/** The merged tools, to register after every member tool is in the book. */
export function mergedTools(deps: MergedToolDeps) {
  const instructionsOf = (merge: Merge) => instructionsOfWith(deps.book, merge);
  const tools = MERGES.filter((merge) => Object.values(merge.ops).every((old) => deps.book.get(old))).map((merge) => {
    // Short: the schema's "Needs:" note gives each op's fields; studio_tool_describe and the skills say more.
    // Registered with an object root (providers and BB refuse a bare oneOf): the op field, and anything else as given.
    // execute picks the op's own schema; the shown schema (configure's override) is the flattened union.
    const opField = z.string().describe(`One of: ${Object.keys(merge.ops).join(", ")}`);
    return {
      name: merge.name,
      description: `${merge.summary} (${merge.field}: ${Object.keys(merge.ops).join(", ")}). Replaces ${Object.values(merge.ops).join(", ")}.`,
      ...(instructionsOf(merge) ? { instructions: instructionsOf(merge)! } : {}),
      parameters: z.object({ [merge.field]: opField }).catchall(z.unknown()),
      execute: async (input: Record<string, unknown>, ctx: unknown) => {
        const { [merge.field]: op, ...rest } = input;
        const opName = String(op);
        const old = Object.prototype.hasOwnProperty.call(merge.ops, opName) ? merge.ops[opName] : undefined;
        if (!old || !(await deps.allowed(ctx, old))) {
          const usable: string[] = [];
          for (const [each, member] of Object.entries(merge.ops)) {
            if (each === opName) continue;
            if (await deps.allowed(ctx, member)) usable.push(each);
          }
          return usable.length ? `${merge.name}: ${merge.field} must be one of: ${opsNote(merge, deps.book, usable)}.` : `${merge.name} isn't available in this thread.`;
        }
        const checked = mergedParameters(merge, deps.book, [opName]).safeParse(input);
        if (!checked.success) return `${merge.name} ${opName} can't take that: ${checked.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}`;
        const back = Object.fromEntries(Object.entries(merge.rename?.[opName] ?? {}).map(([from, to]) => [to, from]));
        const args = Object.fromEntries(Object.entries(rest).map(([key, value]) => [back[key] ?? key, value]));
        return await deps.book.run(old, args, ctx, `${merge.name} ${opName}`);
      },
    };
  });

  const pagesList = deps.book.get("pages_list");
  const pagesComments = deps.book.get("pages_comments");
  const pagesRead = deps.book.get(INTERNAL_RENAMES.pages_read!);
  if (pagesList && pagesComments && pagesRead) {
    const readShape = (pagesRead.parameters as unknown as { shape: Record<string, z.ZodType> }).shape;
    const listShape = (pagesList.parameters as unknown as { shape: Record<string, z.ZodType> }).shape;
    const { page: _page, ...commentShape } = (pagesComments.parameters as unknown as { shape: Record<string, z.ZodType> }).shape;
    tools.push({
      name: "pages_read",
      description: `${pagesRead.description} Without page: lists pages (query, type). With comments: reads or changes the page's comments (comments.op and its fields). Replaces pages_list, pages_comments.`,
      parameters: z.object({
        page: readShape.page!.optional(),
        ...Object.fromEntries(Object.entries(readShape).filter(([key]) => key !== "page")),
        ...Object.fromEntries(Object.entries(listShape).map(([key, value]) => [key, value.optional()])),
        comments: z.object(commentShape).optional().describe("Read or change this page's comments (pages_comments' fields)"),
      }),
      execute: async (input: Record<string, unknown>, ctx: unknown) => {
        const { page, comments, query, type, after, ...read } = input;
        if (page === undefined && comments !== undefined) return "pages_read with comments needs page.";
        if (page === undefined) {
          if (!(await deps.allowed(ctx, "pages_list"))) return `pages_read without page (the list) isn't available in this thread.`;
          return await deps.book.run("pages_list", { query, type, after }, ctx, "pages_read");
        }
        if (comments !== undefined) {
          if (!(await deps.allowed(ctx, "pages_comments"))) return `pages_read with comments isn't available in this thread.`;
          return await deps.book.run("pages_comments", { page, ...(comments as Record<string, unknown>) }, ctx, "pages_read comments");
        }
        if (!(await deps.allowed(ctx, "pages_read"))) return "pages_read with page isn't available in this thread.";
        return await deps.book.run(INTERNAL_RENAMES.pages_read!, { page, ...read }, ctx, "pages_read");
      },
    } as never);
  }

  const commentsList = deps.book.get(INTERNAL_RENAMES.code_comments!);
  const commentReply = deps.book.get("code_comment_reply");
  if (commentsList && commentReply) {
    const replyShape = (commentReply.parameters as unknown as { shape: Record<string, z.ZodType> }).shape;
    tools.push({
      name: "code_comments",
      description: `${firstSentence(commentsList.description)} (op list, the default), or reply to one (op reply: id, body, resolve). Replaces code_comment_reply.`,
      parameters: z.object({ op: z.enum(["list", "reply"]).optional(), ...Object.fromEntries(Object.entries(replyShape).map(([key, value]) => [key, value.optional()])), ...((commentsList.parameters as unknown as { shape: Record<string, z.ZodType> }).shape ?? {}) }),
      execute: async (input: Record<string, unknown>, ctx: unknown) => {
        const { op = "list", ...rest } = input;
        if (op === "reply") {
          if (!(await deps.allowed(ctx, "code_comment_reply"))) return `code_comments op "reply" isn't available in this thread.`;
          return await deps.book.run("code_comment_reply", rest, ctx, "code_comments reply");
        }
        if (!(await deps.allowed(ctx, "code_comments"))) return `code_comments op "list" isn't available in this thread.`;
        return await deps.book.run(INTERNAL_RENAMES.code_comments!, rest.after !== undefined ? { after: rest.after } : {}, ctx, "code_comments");
      },
    } as never);
  }
  return tools;
}
