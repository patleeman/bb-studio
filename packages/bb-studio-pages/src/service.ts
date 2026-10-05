import { errorMessage as errorText, untitled } from "@bb-studio/kit/format";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import * as Y from "yjs";
import { actorColor } from "./actors";
import { HUMAN_USER_ID, PLUGIN_ID, REALTIME_CHANNEL, type RealtimeEvent } from "./constants";
import type { PageMetaView, RequestView } from "./contract";
import { applyEdits, commentAnchors, readMarkdown, replaceContent, restoreFromState, seedMarkdown, type EditOp, type EditResult } from "./doc";
import { editDocument } from "./document-edit";
import { PageHub, type Actor, type LivePage } from "./hub";
import { PageStore, type PageMeta, type RequestRow } from "./store";

const SNAPSHOT_GAP_MS = 10 * 60_000;
export const pageUrl = (pageId: string) => `/plugins/${PLUGIN_ID}/pages/${pageId}`;

export function toView(meta: PageMeta): PageMetaView {
  return {
    id: meta.id,
    projectId: meta.project_id,
    parentId: meta.parent_id,
    title: meta.title,
    icon: meta.icon,
    position: meta.position,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
    updatedBy: meta.updated_by,
    archived: meta.archived_at !== null,
  };
}

export function requestView(row: RequestRow): RequestView {
  return {
    id: row.id,
    botId: row.bot_id,
    botName: row.bot_name,
    threadId: row.thread_id,
    kind: row.kind,
    blockId: row.block_id,
    commentThreadId: row.comment_thread_id,
    summary: row.summary,
    status: row.status,
    error: row.error,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PagesService {
  readonly hub: PageHub;
  private readonly actorNames = new Map<string, string>();
  /** Called after every realtime event, e.g. to tell Studio. */
  onPublish: ((event: RealtimeEvent) => void) | null = null;

  constructor(
    private readonly bb: BbPluginApi,
    readonly store: PageStore,
  ) {
    this.hub = new PageHub({
      load: (pageId) => this.store.get(pageId)?.state ?? null,
      save: (pageId, doc, actors) => {
        const agent = actors.find((actor) => actor !== HUMAN_USER_ID);
        this.store.saveContent(pageId, Y.encodeStateAsUpdate(doc), readMarkdown(doc), agent ?? actors[0] ?? HUMAN_USER_ID);
        this.publish({ type: "page", pageId });
      },
      saveError: (pageId, error) => this.bb.log.error(`Could not save page ${pageId}; retrying: ${String(error)}`),
    });
  }

  publish(event: RealtimeEvent): void {
    try {
      this.bb.realtime.publish(REALTIME_CHANNEL, event);
    } catch {
      // Best effort; open views refetch on reconnect.
    }
    // Comment and bot-request traffic doesn't change what Studio lists.
    if (event.type !== "requests") this.onPublish?.(event);
  }

  // Pages -------------------------------------------------------------------

  requirePage(ref: string, projectId?: string | null): PageMeta {
    const trimmed = ref.trim();
    const byId = this.store.meta(trimmed);
    if (byId) return byId;
    const lower = trimmed.toLowerCase();
    const candidates = this.store.list({ projectId }).filter((page) => page.title.trim().toLowerCase() === lower);
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length > 1) {
      throw new Error(`Several pages are titled "${trimmed}": ${candidates.map((page) => page.id).join(", ")}. Use an id.`);
    }
    throw new Error(`No page "${trimmed}". Use pages_list to find page ids.`);
  }

  createPage(input: {
    projectId: string | null;
    parentId: string | null;
    title: string;
    icon?: string;
    markdown?: string;
    actor: string;
  }): PageMeta {
    if (input.parentId) {
      const parent = this.store.meta(input.parentId);
      if (!parent) throw new Error(`No parent page "${input.parentId}".`);
      input.projectId = parent.project_id;
    }
    const meta = this.store.create(input);
    const doc = new Y.Doc();
    seedMarkdown(doc, input.markdown ?? "");
    this.store.saveContent(meta.id, Y.encodeStateAsUpdate(doc), readMarkdown(doc), null);
    doc.destroy();
    this.publish({ type: "tree", projectId: meta.project_id });
    return this.store.meta(meta.id)!;
  }

  deletePage(id: string): string[] {
    const ids = [id, ...this.store.descendants(id)];
    for (const pageId of ids) this.hub.evict(pageId);
    this.store.delete(ids);
    this.publish({ type: "deleted", pageIds: ids });
    return ids;
  }

  // Actors ------------------------------------------------------------------

  async actorForThread(threadId: string): Promise<{ actor: Actor }> {
    const key = `agent:${threadId}`;
    let name = this.actorNames.get(threadId);
    if (!name) {
      try {
        const thread = await this.bb.sdk.threads.get({ threadId });
        name = thread.title?.trim() ? `Agent · ${truncate(thread.title.trim(), 24)}` : "Agent";
      } catch {
        name = "Agent";
      }
      this.actorNames.set(threadId, name);
    }
    return { actor: { key, name, color: actorColor(key) } };
  }

  // Agent edits ---------------------------------------------------------------

  /** Takes a restore point before an actor's first edit in a while. */
  snapshotBefore(page: LivePage, actor: Actor): void {
    const latest = this.store.latestSnapshot(page.id);
    if (latest && latest.actor === actor.key && Date.now() - latest.created_at < SNAPSHOT_GAP_MS) return;
    this.store.addSnapshot(page.id, Y.encodeStateAsUpdate(page.doc), `Before ${actor.name}`, actor.key);
  }

  edit(pageId: string, ops: EditOp[], actor: Actor): EditResult {
    const page = this.hub.open(pageId);
    this.snapshotBefore(page, actor);
    const result = applyEdits(page.doc, ops, actor.key);
    if (result.changed) {
      this.hub.showPresence(page, actor, result.touched[0] ?? null);
    }
    return result;
  }

  /** Applies the whole page as plain Markdown, rewriting only the blocks that changed. */
  editClientDocument(pageId: string, expected: string, markdown: string): string {
    if (!this.store.meta(pageId)) throw new Error("Page not found.");
    const page = this.hub.open(pageId);
    if (readMarkdown(page.doc, { ids: true }) !== expected) {
      throw new Error("Page changed while you were editing. Reload and try again.");
    }
    const locked = new Set([...commentAnchors(page.doc).values()].map((anchor) => anchor.blockId));
    if (editDocument(page.doc, markdown, locked, { client: "rpc" }).changed) this.hub.flush(page);
    return readMarkdown(page.doc, { ids: true });
  }

  /** Saves a named version, then replaces the whole page with `markdown`, live. */
  replaceMarkdown(pageId: string, markdown: string, snapshotName: string, actor: Actor): PageMeta {
    if (!this.store.meta(pageId)) throw new Error("Page not found.");
    const page = this.hub.open(pageId);
    this.store.addSnapshot(page.id, Y.encodeStateAsUpdate(page.doc), snapshotName, actor.key);
    const result = replaceContent(page.doc, markdown, actor.key);
    if (result.changed) {
      this.hub.showPresence(page, actor, result.touched[0] ?? null);
      // Saves now, so the returned meta carries this edit.
      this.hub.flush(page);
    }
    return this.store.meta(pageId)!;
  }

  restore(snapshotId: string, actor: string): boolean {
    const snapshot = this.store.snapshotState(snapshotId);
    if (!snapshot) throw new Error("Snapshot not found.");
    const page = this.hub.open(snapshot.page_id);
    this.store.addSnapshot(page.id, Y.encodeStateAsUpdate(page.doc), "Before restore", actor);
    return restoreFromState(page.doc, new Uint8Array(snapshot.state), actor);
  }

  requestPrompt(page: PageMeta, lines: string[]): string {
    return [
      `[Pages] ${lines[0]}`,
      "",
      ...lines.slice(1),
      "",
      `Page: "${untitled(page.title)}" (id ${page.id}, ${pageUrl(page.id)}).`,
      "Use pages_read to see the page with block ids, pages_edit to change it, and the pages_comment tools to answer in the page. The user sees your edits live.",
    ].join("\n");
  }

  dispose(): void {
    this.hub.disposeAll();
  }
}

export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
export { errorText };
