import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DrawingStore, MIGRATIONS } from "./store";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import plugin from "../../server";
import { element, scene } from "../test/db";

it("atomically rejects stale recovery, keeps ordinary merge, and distinguishes same-millisecond writes", async () => {
  const host = createFakePluginHost({ pluginId: "excalidraw", sdk: {
    plugins: { callRpc: async () => { throw new Error("Studio is optional"); } },
  } });
  await plugin(host.bb);
  const call = (method: string, input: unknown): Promise<any> => host.harness.behavior.callRpc(method, input);
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  try {
    const { drawing } = await call("createDrawing", { name: "Recovery", projectId: "proj_a" });
    const first = await call("saveDrawing", { id: drawing.id, data: scene([element("rectangle", { id: "remote" })]), expectedUpdatedAt: drawing.updatedAt });
    expect(first.updatedAt).toBeGreaterThan(drawing.updatedAt);
    const draft = scene([element("ellipse", { id: "local" })]);
    await expect(call("saveDrawing", { id: drawing.id, data: draft, expectedUpdatedAt: drawing.updatedAt })).rejects.toThrow("changed on the server");
    expect(JSON.parse((await call("getDrawing", { id: drawing.id })).drawing.data).elements.map((el: any) => el.id)).toEqual(["remote"]);
    // Legacy/mobile callers omit the guard and retain the normal full-scene merge.
    const second = await call("saveDrawing", { id: drawing.id, data: draft });
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(JSON.parse((await call("getDrawing", { id: drawing.id })).drawing.data).elements.map((el: any) => el.id).sort()).toEqual(["local", "remote"]);
    const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => call("saveDrawing", { id: drawing.id, data: draft, expectedUpdatedAt: second.updatedAt })));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(2);
  } finally { now.mockRestore(); await host.harness.lifecycle.dispose(); }
});

it("returns one complete recovery copy after a lost response and concurrent retries", async () => {
  const host = createFakePluginHost({ pluginId: "excalidraw", sdk: {
    plugins: { callRpc: async () => { throw new Error("Studio is optional"); } },
  } });
  await plugin(host.bb);
  const call = (method: string, input: unknown): Promise<any> => host.harness.behavior.callRpc(method, input);
  try {
    const { drawing: original } = await call("createDrawing", { name: "Original", projectId: "proj_original" });
    const originalData = (await call("getDrawing", { id: original.id })).drawing.data;
    const data = JSON.stringify({ elements: [element("rectangle", { id: "recovered" })], appState: {}, files: { image: { dataURL: "data:image/png;base64,bytes" } } });
    const input = { sourceDrawingId: original.id, draftId: "editor", draftToken: "edit-1", name: "Recovered", data, projectId: "stale-project" };
    // The server commits, but the caller never receives/uses its response.
    await call("recoverDrawingCopy", input);
    const results = await Promise.all(Array.from({ length: 12 }, () => call("recoverDrawingCopy", input)));
    const copy = results[0].drawing;
    expect(new Set(results.map(result => result.drawing.id)).size).toBe(1);
    expect(copy).toMatchObject({ projectId: "proj_original", elementCount: 1 });
    expect((await call("listDrawings", null)).drawings).toHaveLength(2);
    expect(JSON.parse((await call("getDrawing", { id: copy.id })).drawing.data)).toMatchObject(JSON.parse(data));
    expect((await call("getDrawing", { id: original.id })).drawing.data).toBe(originalData);
    // Later user changes to the copy must never be overwritten by a retry.
    await call("renameDrawing", { id: copy.id, name: "User renamed copy" });
    expect((await call("recoverDrawingCopy", input)).drawing).toMatchObject({ id: copy.id, name: "User renamed copy" });
    await call("deleteDrawing", { id: copy.id });
    const replacement = (await call("recoverDrawingCopy", input)).drawing;
    expect(replacement.id).not.toBe(copy.id);
    expect((await call("listDrawings", null)).drawings).toHaveLength(2);
    const nextEdit = (await call("recoverDrawingCopy", { ...input, draftToken: "edit-2" })).drawing;
    expect(nextEdit.id).not.toBe(replacement.id);
  } finally { await host.harness.lifecycle.dispose(); }
});


it("retains the recovery copy key across database restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "draw-recovery-"));
  let db = new Database(join(directory, "drawings.sqlite"));
  try {
    for (const migration of MIGRATIONS) db.exec(migration);
    const input = { key: JSON.stringify(["original", "editor", "token"]), name: "Recovered", data: scene([element("rectangle")]) };
    const first = new DrawingStore(db).recoverCopy(input).row;
    db.close();
    db = new Database(join(directory, "drawings.sqlite"));
    const reopened = new DrawingStore(db);
    const retried = reopened.recoverCopy(input);
    expect(retried).toMatchObject({ row: { id: first.id, data: first.data }, created: false });
    expect(reopened.list()).toHaveLength(1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
