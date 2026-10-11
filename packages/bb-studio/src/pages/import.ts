// What the Pages upgrade bridge copies into Studio (packages/bb-studio-pages):
// files, saved versions and pages, each keeping its id and times. A row Studio
// already has is left as it is, so a rerun changes nothing.
//
// The old plugin served uploaded files at /api/v1/plugins/pages/http/files,
// and pages embed that address in their content. Studio serves them at
// /api/v1/plugins/studio/http/pages/files, so imported pages and versions
// point at Studio's (rewriteFileUrls). The editor maps any old address left
// over, such as one restored from an old backup, the same way.
import { LEGACY_PAGE_FILES_URL, PAGE_FILES_URL, type ImportFile, type ImportPage, type ImportSnapshot } from "@bb-studio/kit/pages-contract";
import type Database from "better-sqlite3";
import * as Y from "yjs";
import { DOCUMENT_FRAGMENT } from "./schema-config";

type Result = { imported: string[]; existing: string[]; skipped: { id: string; reason: string }[] };

const LEGACY_BYTES = Buffer.from(LEGACY_PAGE_FILES_URL);

/**
 * A page's Yjs state with old file addresses in its blocks' attributes (an
 * image's or file's `url`) and in its links' `href` pointed at Studio's. Unchanged when there are none.
 */
export function rewriteFileUrls(state: Uint8Array): Uint8Array {
  if (!Buffer.from(state.buffer, state.byteOffset, state.byteLength).includes(LEGACY_BYTES)) return state;
  const doc = new Y.Doc({ gc: false });
  Y.applyUpdate(doc, state);
  let changed = false;
  const visit = (node: Y.XmlElement | Y.XmlFragment) => {
    if (node instanceof Y.XmlElement) {
      for (const [key, value] of Object.entries(node.getAttributes())) {
        if (typeof value !== "string") continue;
        const next = value.split(LEGACY_PAGE_FILES_URL).join(PAGE_FILES_URL);
        if (next !== value) { node.setAttribute(key, next); changed = true; }
      }
    }
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) visit(child);
      else if (child instanceof Y.XmlText) relink(child);
    }
  };
  // Links in text are marks: `link: { href }` on a run of characters.
  const relink = (text: Y.XmlText) => {
    let index = 0;
    for (const op of text.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
      const length = typeof op.insert === "string" ? op.insert.length : 1;
      for (const [mark, value] of Object.entries(op.attributes ?? {})) {
        if (!value || typeof value !== "object") continue;
        const attrs = value as Record<string, unknown>;
        if (typeof attrs.href === "string" && attrs.href.includes(LEGACY_PAGE_FILES_URL)) {
          text.format(index, length, { [mark]: { ...attrs, href: attrs.href.split(LEGACY_PAGE_FILES_URL).join(PAGE_FILES_URL) } });
          changed = true;
        }
      }
      index += length;
    }
  };
  doc.transact(() => visit(doc.getXmlFragment(DOCUMENT_FRAGMENT)));
  const result = changed ? Y.encodeStateAsUpdate(doc) : state;
  doc.destroy();
  return result;
}

const markdownUrls = (markdown: string) => markdown.split(LEGACY_PAGE_FILES_URL).join(PAGE_FILES_URL);
const stateOf = (base64: string) => Buffer.from(rewriteFileUrls(new Uint8Array(Buffer.from(base64, "base64"))));

export function importPages(db: Database.Database) {
  const hasPage = db.prepare("SELECT 1 FROM pages WHERE id = ?");
  const hasSnapshot = db.prepare("SELECT 1 FROM snapshots WHERE id = ?");
  const hasFile = db.prepare("SELECT 1 FROM files WHERE id = ?");
  const insertPage = db.prepare(
    `INSERT INTO pages (id, project_id, parent_id, title, icon, position, state, markdown, created_at, updated_at, updated_by, archived_at,
       refresh_bot_id, refresh_cron, refresh_instructions, refresh_last_at, template)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertChat = db.prepare("INSERT OR IGNORE INTO chats (thread_id, page_id, created_at) VALUES (?, ?, ?)");
  const insertRequest = db.prepare(
    `INSERT OR IGNORE INTO requests (id, page_id, bot_id, bot_name, thread_id, kind, block_id, comment_thread_id, summary, status, error, result, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertHandoff = db.prepare(
    "INSERT OR IGNORE INTO checklist_handoffs (thread_id, page_id, block_id, title, state, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertSnapshot = db.prepare("INSERT INTO snapshots (id, page_id, state, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const insertFile = db.prepare("INSERT INTO files (id, page_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");

  return {
    /** One uploaded file. True once Studio has it. */
    file(file: ImportFile): boolean {
      if (hasFile.get(file.id)) return true;
      const data = Buffer.from(file.data, "base64");
      if (data.byteLength !== file.size) throw new Error(`File ${file.id} arrived with ${data.byteLength} of its ${file.size} bytes.`);
      insertFile.run(file.id, file.pageId, file.name, file.mime, file.size, data, file.createdAt);
      return true;
    },

    snapshots(snapshots: readonly ImportSnapshot[]): Result {
      const result: Result = { imported: [], existing: [], skipped: [] };
      db.transaction(() => {
        for (const snapshot of snapshots) {
          if (hasSnapshot.get(snapshot.id)) { result.existing.push(snapshot.id); continue; }
          try {
            insertSnapshot.run(snapshot.id, snapshot.pageId, stateOf(snapshot.state), snapshot.label, snapshot.actor, snapshot.createdAt);
            result.imported.push(snapshot.id);
          } catch (error) {
            result.skipped.push({ id: snapshot.id, reason: error instanceof Error ? error.message : String(error) });
          }
        }
      })();
      return result;
    },

    /** Pages with their chats, requests and checklist hand-offs; their files and versions came first. */
    pages(pages: readonly ImportPage[]): Result {
      const result: Result = { imported: [], existing: [], skipped: [] };
      db.transaction(() => {
        for (const page of pages) {
          if (hasPage.get(page.id)) { result.existing.push(page.id); continue; }
          let state: Buffer | null;
          try {
            state = page.state === null ? null : stateOf(page.state);
          } catch (error) {
            result.skipped.push({ id: page.id, reason: `Its content can't be read: ${error instanceof Error ? error.message : String(error)}` });
            continue;
          }
          insertPage.run(
            page.id, page.projectId, page.parentId, page.title, page.icon, page.position, state, markdownUrls(page.markdown),
            page.createdAt, page.updatedAt, page.updatedBy, page.archivedAt,
            page.refresh.botId, page.refresh.cron, page.refresh.instructions, page.refresh.lastAt, page.template ? 1 : 0,
          );
          for (const chat of page.chats) insertChat.run(chat.threadId, page.id, chat.createdAt);
          for (const request of page.requests) {
            insertRequest.run(request.id, page.id, request.botId, request.botName, request.threadId, request.kind, request.blockId, request.commentThreadId,
              request.summary, request.status, request.error, request.result, request.dedupeKey, request.createdAt, request.updatedAt);
          }
          for (const handoff of page.checklistHandoffs) {
            insertHandoff.run(handoff.threadId, page.id, handoff.blockId, handoff.title, handoff.state, handoff.note, handoff.createdAt, handoff.updatedAt);
          }
          result.imported.push(page.id);
        }
      })();
      return result;
    },
  };
}
