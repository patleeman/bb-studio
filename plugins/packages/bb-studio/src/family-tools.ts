// Agent tools by family (src/item-model.ts). Every type keeps the tools it
// had (`design_*`, `artifacts_*`, `minis_*`, `whiteboard_*`),
// with the same parameters. The family names sit on top and run those same
// handlers:
// - pages_list, pages_read and pages_create also take a design or a
//   whiteboard: `type` on list and create, the item's id on read.
// - apps_list, apps_read and apps_create cover mini apps and artifacts.
// Each older tool's description says which family tool does the same.
import { z } from "zod";
import type { IndexedItem, IndexListOptions } from "./item-index";
import { familyHref, itemType, typeOfId, type ItemType } from "./item-model";

type ToolContext = { threadId?: string; projectId?: string | null };
export interface AgentTool {
  name: string;
  description: string;
  parameters: z.ZodType;
  execute(input: never, ctx: never): unknown;
}

const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/** Every registered tool by name, so a family tool can run a type's own handler. */
export class ToolBook {
  private readonly tools = new Map<string, AgentTool>();

  add(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | null {
    return this.tools.get(name) ?? null;
  }

  /** Runs a tool as BB would: its own parameters parse the input, then its handler runs. */
  async run(name: string, input: unknown, ctx: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) return fail(`${name} isn't available.`);
    const parsed = tool.parameters.safeParse(input);
    if (!parsed.success) return fail(`${name} can't take that: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}`);
    return await tool.execute(parsed.data as never, ctx as never);
  }
}

/** How each type's own tools are reached from the family tools. */
export const TYPE_TOOLS: Record<Exclude<ItemType, "doc">, { list: string; read: string; create: string; idParam: string; label: string }> = {
  design: { list: "design_list", read: "design_read", create: "design_create", idParam: "designId", label: "Designs" },
  whiteboard: { list: "whiteboard_list", read: "whiteboard_get", create: "whiteboard_create", idParam: "whiteboardId", label: "Whiteboards" },
  mini: { list: "minis_list", read: "minis_read", create: "minis_create", idParam: "miniId", label: "Mini apps" },
  artifact: { list: "artifacts_list", read: "artifacts_read", create: "artifacts_save", idParam: "artifactId", label: "Artifacts" },
};

export const APP_TOOLS = ["apps_list", "apps_read", "apps_create"] as const;
const APP_TYPES = ["mini", "artifact"] as const;
const PAGE_TYPES = ["doc", "design", "whiteboard"] as const;

/** What each type's tool says about the family tool that does the same. */
const POINTERS: Record<string, string> = {
  design_list: 'A design is a type of page: pages_list with type "design" gives this same list.',
  design_read: "A design is a type of page: pages_read with the design's id reads it the same way.",
  design_create: 'A design is a type of page: pages_create with type "design" makes one the same way.',
  whiteboard_list: 'A whiteboard is a type of page: pages_list with type "whiteboard" gives this same list.',
  whiteboard_get: "A whiteboard is a type of page: pages_read with the whiteboard's id reads it the same way.",
  whiteboard_create: 'A whiteboard is a type of page: pages_create with type "whiteboard" makes a page holding one.',
  minis_list: 'A mini app is a type of app: apps_list lists every app, and with type "mini" gives this same list.',
  minis_read: "A mini app is a type of app: apps_read with its id reads it the same way.",
  minis_create: 'A mini app is a type of app: apps_create with type "mini" makes one the same way.',
  artifacts_list: 'An artifact is a type of app: apps_list lists every app, and with type "artifact" gives this same list.',
  artifacts_read: "An artifact is a type of app: apps_read with its id reads it the same way.",
  artifacts_save: 'An artifact is a type of app: apps_create with type "artifact" saves one the same way.',
};

export interface FamilyToolDeps {
  book: ToolBook;
  /** Whether a type is on (Setup → Kinds). */
  typeOn(type: ItemType): boolean;
}

const offMessage = (type: Exclude<ItemType, "doc">) => fail(`${TYPE_TOOLS[type].label} are turned off in Studio (Setup → Kinds).`);

/**
 * The tool as Studio registers it. A type's own tool gains a line naming the
 * family tool; pages_list, pages_read and pages_create also take designs and
 * whiteboards. Every input a tool took before means what it meant.
 */
export function familyTool<T extends AgentTool>(tool: T, deps: FamilyToolDeps): T {
  const pointer = POINTERS[tool.name];
  if (pointer) return { ...tool, description: `${tool.description} ${pointer}` };
  const own = tool.execute as (input: Record<string, unknown>, ctx: unknown) => unknown;
  const viaType = (type: "design" | "whiteboard", action: "list" | "read" | "create", input: unknown, ctx: unknown) =>
    deps.typeOn(type) ? deps.book.run(TYPE_TOOLS[type][action], input, ctx) : offMessage(type);
  if (tool.name === "pages_list") {
    return {
      ...tool,
      description: `${tool.description} Pages come in types: a doc (the default here), a design (UI screens or a slide deck) and a whiteboard. Pass type "design" or "whiteboard" to list those.`,
      parameters: (tool.parameters as z.ZodObject).extend({ type: z.enum(PAGE_TYPES).optional().describe('The page type to list: "doc" (default), "design" or "whiteboard"') }),
      execute: (async ({ type, ...input }: { type?: (typeof PAGE_TYPES)[number] } & Record<string, unknown>, ctx: unknown) =>
        type && type !== "doc" ? viaType(type, "list", {}, ctx) : own(input, ctx)) as never,
    };
  }
  if (tool.name === "pages_read") {
    return {
      ...tool,
      description: `${tool.description} Given a design's id (dsn_…) or a whiteboard's (drw_…), it reads that page type instead: a design's rounds and screens, a whiteboard's scene.`,
      execute: (async (input: { page?: unknown } & Record<string, unknown>, ctx: unknown) => {
        const type = typeof input.page === "string" ? typeOfId(input.page.trim())?.type : undefined;
        if (type !== "design" && type !== "whiteboard") return own(input, ctx);
        return viaType(type, "read", { [TYPE_TOOLS[type].idParam]: (input.page as string).trim() }, ctx);
      }) as never,
    };
  }
  if (tool.name === "pages_create") {
    return {
      ...tool,
      description: `${tool.description} Pass type "design" for an empty design named by title (then follow the design skill), or "whiteboard" for a page holding an empty whiteboard; markdown, icon, parent and global apply to docs only.`,
      parameters: (tool.parameters as z.ZodObject).extend({ type: z.enum(PAGE_TYPES).optional().describe('The page type to make: "doc" (default), "design" or "whiteboard"') }),
      execute: (async ({ type, ...input }: { type?: (typeof PAGE_TYPES)[number]; title?: string } & Record<string, unknown>, ctx: unknown) =>
        type && type !== "doc" ? viaType(type, "create", { name: input.title }, ctx) : own(input, ctx)) as never,
    };
  }
  return tool;
}

export interface AppToolDeps extends FamilyToolDeps {
  /** The item index: apps across types, and the type of an id. */
  index: { list(options: IndexListOptions): IndexedItem[]; get(id: string): IndexedItem | null };
}

/** apps_list, apps_read and apps_create, for `register` (BB's registerTool). */
export function appTools(deps: AppToolDeps): AgentTool[] {
  const typeParam = z.enum(APP_TYPES);
  const line = (item: IndexedItem) =>
    `- ${item.title.trim() || "Untitled"} — ${itemType(item.type)!.label} (id ${item.id}), ${item.projectId ? "project" : "global"}, updated ${new Date(item.updatedAt).toISOString()}, link ${familyHref("app", item.id)}`;
  return [
    {
      name: "apps_list",
      description: 'List the user\'s Studio apps, the things that run: mini apps and artifacts (saved files and live HTML). Each line has the type, id and link. Pass type for one type\'s own, fuller list, or query to match titles. Read one with apps_read; make one with apps_create.',
      parameters: z.object({ type: typeParam.optional(), query: z.string().max(200).optional().describe("Words a title must contain") }),
      execute: (async ({ type, query }: { type?: (typeof APP_TYPES)[number]; query?: string }, ctx: ToolContext) => {
        const needle = query?.trim().toLowerCase();
        if (type && !needle) return deps.typeOn(type) ? deps.book.run(TYPE_TOOLS[type].list, {}, ctx) : offMessage(type);
        const items = deps.index.list({ family: "app", ...(type ? { type } : {}), limit: 500 })
          .filter((item) => deps.typeOn(item.type) && (!needle || item.title.toLowerCase().includes(needle)));
        if (!items.length) return needle ? `No apps match "${query}".` : "No apps yet. Make one with apps_create.";
        return [...items.slice(0, 100).map(line), ...(items.length > 100 ? [`…and ${items.length - 100} more. Pass type or query to narrow it.`] : [])].join("\n");
      }) as never,
    },
    {
      name: "apps_read",
      description: "Read a Studio app by its id, whatever its type: a mini app's source, state and records summary (mini_…), or an artifact's details and text (art_…). The same as minis_read and artifacts_read. Edit with the type's own tool: minis_update, or artifacts_save with artifactId.",
      parameters: z.object({ id: z.string().min(1).max(200).describe("The app's id, from apps_list or its link") }),
      execute: (async ({ id }: { id: string }, ctx: ToolContext) => {
        // The index knows every app; an id it doesn't have yet is read from its prefix.
        const type = deps.index.get(id.trim())?.type ?? typeOfId(id.trim())?.type;
        if (type !== "mini" && type !== "artifact") return fail(`No app with id ${id}. apps_list shows the ids.`);
        return deps.typeOn(type) ? deps.book.run(TYPE_TOOLS[type].read, { [TYPE_TOOLS[type].idParam]: id.trim() }, ctx) : offMessage(type);
      }) as never,
    },
    {
      name: "apps_create",
      description: 'Make a Studio app. type "mini": a small interactive app with its own data (input as minis_create: name, files). type "artifact": save a finished file (input as artifacts_save: title, and path or content with name). `input` takes exactly the fields of that tool, whose description has the details; the result is the same.',
      parameters: z.object({ type: typeParam, input: z.record(z.string(), z.unknown()).describe("The fields of minis_create or artifacts_save, by type") }),
      execute: (async ({ type, input }: { type: (typeof APP_TYPES)[number]; input: Record<string, unknown> }, ctx: ToolContext) =>
        deps.typeOn(type) ? deps.book.run(TYPE_TOOLS[type].create, input, ctx) : offMessage(type)) as never,
    },
  ];
}
