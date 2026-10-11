import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LEGACY_PAGE_FILES_URL, PAGE_FILES_URL, studioFileUrl, type ImportPage } from "@bb-studio/kit/pages-contract";
import { importPages, rewriteFileUrls } from "./import";
import { MIGRATIONS, PageStore } from "./store";
import { DOCUMENT_FRAGMENT } from "./schema-config";

function stateWithImage(url: string): Uint8Array {
  const doc = new Y.Doc();
  const block = new Y.XmlElement("blockContainer");
  const image = new Y.XmlElement("image");
  image.setAttribute("url", url);
  image.setAttribute("caption", "Diagram");
  block.insert(0, [image]);
  doc.getXmlFragment(DOCUMENT_FRAGMENT).insert(0, [block]);
  return Y.encodeStateAsUpdate(doc);
}

function imageUrl(state: Uint8Array): unknown {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const block = doc.getXmlFragment(DOCUMENT_FRAGMENT).get(0) as Y.XmlElement;
  return (block.get(0) as Y.XmlElement).getAttribute("url");
}

const page = (patch: Partial<ImportPage> = {}): ImportPage => ({
  id: "pg_0123456789ab", projectId: "proj_1", parentId: null, title: "Launch", icon: "🚀", position: 1,
  state: Buffer.from(stateWithImage(`${LEGACY_PAGE_FILES_URL}?id=file_1`)).toString("base64"),
  markdown: `![Diagram](${LEGACY_PAGE_FILES_URL}?id=file_1)`, createdAt: 1, updatedAt: 2, updatedBy: "user", archivedAt: null, template: false,
  refresh: { botId: null, cron: null, instructions: "", lastAt: null },
  chats: [{ threadId: "thr_1", createdAt: 3 }], requests: [], checklistHandoffs: [{ threadId: "thr_2", blockId: "blk", title: "Ship", state: "idle", note: null, createdAt: 4, updatedAt: 5 }],
  ...patch,
});

describe("importing the Pages plugin's rows", () => {
  it("points old file addresses at Studio's", () => {
    expect(studioFileUrl(`${LEGACY_PAGE_FILES_URL}?id=file_1`)).toBe(`${PAGE_FILES_URL}?id=file_1`);
    expect(studioFileUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(imageUrl(rewriteFileUrls(stateWithImage(`${LEGACY_PAGE_FILES_URL}?id=file_1`)))).toBe(`${PAGE_FILES_URL}?id=file_1`);
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    doc.getXmlFragment(DOCUMENT_FRAGMENT).insert(0, [paragraph]);
    text.insert(0, "see ");
    text.insert(4, "note.txt", { link: { href: `${LEGACY_PAGE_FILES_URL}?id=file_2` } });
    const linked = new Y.Doc();
    Y.applyUpdate(linked, rewriteFileUrls(Y.encodeStateAsUpdate(doc)));
    const run = (((linked.getXmlFragment(DOCUMENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText).toDelta() as { attributes?: { link?: { href: string } } }[])[1];
    expect(run?.attributes?.link?.href).toBe(`${PAGE_FILES_URL}?id=file_2`);
    const untouched = stateWithImage("https://example.com/a.png");
    expect(rewriteFileUrls(untouched)).toBe(untouched);
  });

  it("keeps ids and times, copies files and versions, and leaves what Studio has alone", () => {
    const db = new Database(":memory:");
    for (const sql of MIGRATIONS) db.exec(sql);
    const imports = importPages(db);
    const data = Buffer.from("png bytes");
    expect(imports.file({ id: "file_1", pageId: "pg_0123456789ab", name: "a.png", mime: "image/png", size: data.length, createdAt: 1, data: data.toString("base64") })).toBe(true);
    expect(() => imports.file({ id: "file_2", pageId: "pg_0123456789ab", name: "b.png", mime: "image/png", size: 99, createdAt: 1, data: data.toString("base64") })).toThrow("bytes");
    const snapshot = { id: "snap_1", pageId: "pg_0123456789ab", state: page().state!, label: "Before", actor: "user", createdAt: 1 };
    expect(imports.snapshots([snapshot])).toEqual({ imported: ["snap_1"], existing: [], skipped: [] });
    expect(imports.snapshots([snapshot])).toEqual({ imported: [], existing: ["snap_1"], skipped: [] });
    expect(imports.pages([page()])).toEqual({ imported: ["pg_0123456789ab"], existing: [], skipped: [] });
    expect(imports.pages([page({ title: "Changed" })])).toEqual({ imported: [], existing: ["pg_0123456789ab"], skipped: [] });

    const store = new PageStore(db);
    expect(store.meta("pg_0123456789ab")).toMatchObject({ title: "Launch", created_at: 1, updated_at: 2, project_id: "proj_1" });
    const row = store.get("pg_0123456789ab")!;
    expect(row.markdown).toBe(`![Diagram](${PAGE_FILES_URL}?id=file_1)`);
    expect(imageUrl(new Uint8Array(row.state!))).toBe(`${PAGE_FILES_URL}?id=file_1`);
    expect(imageUrl(new Uint8Array(store.snapshotState("snap_1")!.state))).toBe(`${PAGE_FILES_URL}?id=file_1`);
    expect(store.file("file_1")?.data.toString()).toBe("png bytes");
    expect(store.chatPageId("thr_1")).toBe("pg_0123456789ab");
    expect(db.prepare("SELECT title FROM checklist_handoffs WHERE thread_id = 'thr_2'").get()).toEqual({ title: "Ship" });
  });
});
