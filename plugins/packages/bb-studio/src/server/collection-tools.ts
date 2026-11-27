import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { errorText, type StudioHub } from "../hub";
import { WORKSPACE_CHANNEL } from "../ids";
import { STUDIO_PLUGIN_ID } from "../kit/contract";
import { untitled } from "../kit/format";
import type { TabStore } from "../tabs";
import type { ItemRef, Tag, TagStore } from "../tags";
import { formatWorkspace, openHrefs, type WorkspaceCommand, type WorkspacePresence } from "../workspace-presence";

/** How long a window gets to report a command's result. */
const CONFIRM_MS = 3000;

export interface MoveResult {
  moved: { title: string }[];
  unchanged: { title: string }[];
  failed: { title: string; error: string }[];
}

export interface CollectionToolsDeps {
  bb: BbPluginApi;
  hub: StudioHub;
  tags: TagStore;
  tabs: TabStore;
  workspace: WorkspacePresence;
  tagsChanged: () => void;
  tabsChanged: () => void;
  moveItems: (refs: readonly ItemRef[], target: { projectId: string | null }) => Promise<MoveResult>;
  deleteItems: (pluginId: string, ids: string[]) => Promise<{ done: string[]; failed: { id: string; error: string }[] }>;
}

/** Registers Studio's collection & workspace agent tools and returns shared item-move helpers for the CLI. */
export function registerCollectionTools({
  bb,
  hub,
  tags,
  tabs,
  workspace,
  tagsChanged,
  tabsChanged,
  moveItems,
  deleteItems,
}: CollectionToolsDeps) {
  /** Finds items by link or `<plugin>:<id>`, as studio_list_items shows them. */
  const resolveItems = async (refs: readonly string[]) => {
    const { items } = await hub.overview();
    const found: ItemRef[] = [];
    const missing: string[] = [];
    for (const ref of refs) {
      const trimmed = ref.trim().replace(/^\((.*)\)$/, "$1");
      const item = items.find((each) => each.href === trimmed || `${each.pluginId}:${each.id}` === trimmed);
      if (item) found.push({ pluginId: item.pluginId, id: item.id });
      else missing.push(ref);
    }
    return { found, missing };
  };

  /** A project by id or name; "global" is no project. */
  const resolveProject = async (ref: string): Promise<string | null> => {
    if (ref.trim().toLowerCase() === "global") return null;
    const projects = (await bb.sdk.projects.list({ includePersonal: true })) as { id: string; name: string }[];
    const found = projects.find((project) => project.id === ref) ?? projects.find((project) => project.name.toLowerCase() === ref.trim().toLowerCase());
    if (!found) throw new Error(`No project called "${ref}".`);
    return found.id;
  };

  /** Moves items by link and says what happened, a line each. */
  const moveItemsReport = async (refs: readonly string[], target: { projectId: string | null }, label: string) => {
    const { found, missing } = await resolveItems(refs);
    const lines: string[] = [];
    if (found.length) {
      const { moved, unchanged, failed } = await moveItems(found, target);
      lines.push(`${label}: moved ${moved.length} item${moved.length === 1 ? "" : "s"}${moved.length ? ` (${moved.map((item) => item.title).join(", ")})` : ""}.`);
      if (unchanged.length) lines.push(`Already there: ${unchanged.map((item) => item.title).join(", ")}`);
      if (failed.length) lines.push(`Failed: ${failed.map((item) => `${item.title} (${item.error})`).join(", ")}`);
    }
    if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
    return lines;
  };

  bb.agents.registerTool({
    name: "studio_tag_items",
    description:
      "Group the user's BB Studio items with tags. Tags work across pages, recordings, drawings, artifacts and other items; new tag names are created. Pass items as the links studio_list_items shows.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(100).describe("Item links, e.g. /plugins/studio/studio/pages/pg_x"),
      add: z.array(z.string().max(100)).max(20).optional().describe("Tag names to add"),
      remove: z.array(z.string().max(100)).max(20).optional().describe("Tag names to remove"),
    }),
    async execute({ items, add = [], remove = [] }) {
      if (!add.length && !remove.length) return "Pass tag names to add or remove.";
      const { found, missing } = await resolveItems(items);
      const added: Tag[] = add.map((name) => tags.ensure(name));
      const removed = remove.map((name) => tags.byName(name)).filter((tag): tag is Tag => tag !== null);
      if (found.length) {
        tags.apply(found, added.map((tag) => tag.id), removed.map((tag) => tag.id));
        tagsChanged();
      }
      const lines = [`Updated ${found.length} item${found.length === 1 ? "" : "s"}.`];
      if (added.length) lines.push(`Added: ${added.map((tag) => `#${tag.name}`).join(" ")}`);
      if (removed.length) lines.push(`Removed: ${removed.map((tag) => `#${tag.name}`).join(" ")}`);
      if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
      return lines.join("\n");
    },
  });

  bb.agents.registerTool({
    name: "studio_delete_items",
    description:
      "Permanently delete the user's BB Studio items — pages (with their sub-pages), recordings, drawings, artifacts and other add-on items. Pass items as the links studio_list_items shows. Deletion can't be undone, so delete only what the user asked to remove.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(100).describe("Item links, e.g. /plugins/studio/studio/pages/pg_x"),
    }),
    async execute({ items: refs }) {
      const { found, missing } = await resolveItems(refs);
      const { items, providers } = await hub.overview();
      const deletable = new Set(
        providers.flatMap((provider) => provider.kinds.filter((kind) => kind.capabilities?.delete).map((kind) => `${provider.pluginId}:${kind.id}`)),
      );
      const titles = new Map(items.map((item) => [`${item.pluginId}:${item.id}`, untitled(item.title)]));
      const kinds = new Map(items.map((item) => [`${item.pluginId}:${item.id}`, item.kind]));
      const byPlugin = new Map<string, string[]>();
      const refused: string[] = [];
      for (const { pluginId, id } of found) {
        if (pluginId === STUDIO_PLUGIN_ID || !deletable.has(`${pluginId}:${kinds.get(`${pluginId}:${id}`)}`)) refused.push(titles.get(`${pluginId}:${id}`) ?? id);
        else byPlugin.set(pluginId, [...(byPlugin.get(pluginId) ?? []), id]);
      }
      const deleted: string[] = [];
      const failed: string[] = [];
      for (const [pluginId, ids] of byPlugin) {
        try {
          const result = await deleteItems(pluginId, ids);
          deleted.push(...result.done.map((id) => titles.get(`${pluginId}:${id}`) ?? id));
          failed.push(...result.failed.map(({ id, error }) => `${titles.get(`${pluginId}:${id}`) ?? id} (${error})`));
        } catch (error) {
          failed.push(...ids.map((id) => `${titles.get(`${pluginId}:${id}`) ?? id} (${errorText(error)})`));
        }
      }
      const lines = [`Deleted ${deleted.length} item${deleted.length === 1 ? "" : "s"}${deleted.length ? `: ${deleted.join(", ")}` : ""}.`];
      if (refused.length) lines.push(`Can't be deleted here: ${refused.join(", ")}`);
      if (failed.length) lines.push(`Failed: ${failed.join(", ")}`);
      if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
      return lines.join("\n");
    },
  });

  const sendToWorkspace = (command: WorkspaceCommand) => bb.realtime.publish(WORKSPACE_CHANNEL, command);

  bb.agents.registerTool({
    name: "studio_workspace",
    description:
      'See what the user has open in BB Studio\'s workspace, the tabbed view of their pages, recordings, drawings and other items: each pane\'s tabs, which tab is in front, and whether they\'re looking at it. Use it when the user says "this", "what I\'m looking at" or "my tabs". Open or close tabs with studio_open_items and studio_close_tabs.',
    parameters: z.object({}),
    async execute() {
      return formatWorkspace(workspace.current(), Date.now());
    },
  });

  bb.agents.registerTool({
    name: "studio_open_items",
    description:
      "Open BB Studio items as tabs in the user's Studio workspace, in the BB window they're using, and show it to them. Pass items as the links studio_list_items shows. Open beside what they're looking at with placement right or down. Only open what the user asked to see, or what you made for them to look at.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(20).describe("Item links, e.g. /plugins/studio/studio/pages/pg_x"),
      placement: z.enum(["tab", "right", "down"]).optional().describe("tab (default) adds tabs to the focused pane; right or down splits it and opens them there"),
      show: z.boolean().optional().describe("Bring the workspace on screen (default true); false only adds the tabs"),
    }),
    async execute({ items: refs, placement = "tab", show = true }) {
      const current = workspace.current();
      if (!current) return "No BB window has Studio's workspace, so nothing was opened. The user may not have BB open.";
      const { found, missing } = await resolveItems(refs);
      const { items } = await hub.overview();
      const matched = found.flatMap((ref) => items.filter((item) => item.pluginId === ref.pluginId && item.id === ref.id));
      const opened = matched.map((item) => ({ href: item.href, title: untitled(item.title) }));
      // The sidebar's Studio list shows them too, as it does items the user opens.
      if (matched.map((item) => tabs.open(item)).some(Boolean)) tabsChanged();
      const lines: string[] = [];
      if (opened.length) {
        const confirmed = await workspace.deliver(
          (client) => sendToWorkspace({ client, action: "open", items: opened, placement: placement === "down" ? "bottom" : placement, show }),
          (report) => opened.every((item) => openHrefs(report).has(item.href)),
          CONFIRM_MS,
        );
        lines.push(confirmed
          ? `Opened ${opened.map((item) => item.title).join(", ")} in the user's Studio workspace${placement === "tab" ? "" : `, split ${placement}`}.`
          : `Sent ${opened.map((item) => item.title).join(", ")} to the user's BB windows, but none confirmed; BB may be closed. Don't assume they're open.`);
      }
      if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
      return lines.join("\n") || "Nothing to open.";
    },
  });

  bb.agents.registerTool({
    name: "studio_close_tabs",
    description:
      "Close tabs in the user's Studio workspace. Closing a tab keeps the item. Pass the links studio_workspace shows. Close only tabs the user asked to close, or ones you opened for them.",
    parameters: z.object({
      items: z.array(z.string().max(2000)).min(1).max(100).describe("Tab links, e.g. /plugins/studio/studio/pages/pg_x"),
    }),
    async execute({ items: hrefs }) {
      const current = workspace.current();
      if (!current) return "No BB window has Studio's workspace open.";
      // The last report can lag a tab just opened, so every one is sent.
      const closing = [...new Set(hrefs.map((href) => href.trim()))];
      const before = new Map(workspace.candidates().map((report) => [report.client, openHrefs(report)]));
      const confirmed = await workspace.deliver(
        (client) => sendToWorkspace({ client, action: "close", hrefs: closing }),
        (report) => closing.every((href) => !openHrefs(report).has(href)),
        CONFIRM_MS,
      );
      if (!confirmed) return "Sent the close to the user's BB windows, but none confirmed; BB may be closed.";
      const wasOpen = before.get(confirmed) ?? new Set<string>();
      const closed = closing.filter((href) => wasOpen.has(href));
      return closed.length === closing.length ? `Closed ${closed.length} tab${closed.length === 1 ? "" : "s"}.` : `Closed what was open. Not open: ${closing.filter((href) => !wasOpen.has(href)).join(", ")}`;
    },
  });

  bb.agents.registerTool({
    name: "studio_move_items",
    description:
      "Move the user's BB Studio items to another BB project, or to Global (no project). Pass items as the links studio_list_items shows.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(100).describe("Item links, e.g. /plugins/studio/studio/pages/pg_x"),
      project: z.string().min(1).max(200).describe('The project\'s id or name, or "global" for no project'),
    }),
    async execute({ items, project }) {
      const projectId = await resolveProject(project);
      return (await moveItemsReport(items, { projectId }, projectId ? `Project ${project}` : "Global")).join("\n");
    },
  });

  return { resolveProject, moveItemsReport };
}
