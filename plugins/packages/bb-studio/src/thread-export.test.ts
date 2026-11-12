import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { exportBeforeDelete, registerThreadExportHook } from "./thread-export-hook";

type ListArgs = { threadId: string; limit: string; afterSeq?: string };

function fakeBb(events: number, options: { failGet?: boolean } = {}): BbPluginApi {
  const rows = Array.from({ length: events }, (_unused, index) => ({ id: `evt_${index + 1}`, threadId: "thr_one", seq: index + 1, createdAt: index + 1, scope: { kind: "thread" }, type: "thread/name/updated", data: { threadName: `name ${index + 1}` } }));
  const sdk = {
    threads: {
      get: async ({ threadId }: { threadId: string }) => {
        if (options.failGet) throw new Error("no such thread");
        return { id: threadId, title: "A thread" };
      },
      events: {
        list: async ({ limit, afterSeq }: ListArgs) => rows.filter((row) => row.seq > Number(afterSeq ?? 0)).slice(0, Number(limit)),
      },
    },
  };
  return { sdk } as unknown as BbPluginApi;
}

let folder = "";
beforeEach(async () => { folder = await mkdtemp(path.join(tmpdir(), "studio-thread-export-")); });
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

describe("export before delete", () => {
  it("writes the thread and every event across pages, one JSON value per line", async () => {
    await exportBeforeDelete(fakeBb(250), { enabled: true, folder }, "thr_one", 1000);

    const lines = (await readFile(path.join(folder, "thr_one.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { kind: string; event?: { seq: number } });
    expect(lines[0]).toMatchObject({ kind: "thread", formatVersion: 1, exportedAt: 1000, thread: { id: "thr_one" } });
    expect(lines.slice(1).map((line) => line.event?.seq)).toEqual(Array.from({ length: 250 }, (_unused, index) => index + 1));
    expect(await readdir(folder)).toEqual(["thr_one.jsonl"]);
  });

  it("does nothing when the setting is off", async () => {
    await exportBeforeDelete(fakeBb(3), { enabled: false, folder }, "thr_one", 1000);
    expect(await readdir(folder)).toEqual([]);
  });

  it("stops the deletion when no folder is set or the thread cannot be read, and leaves no partial file", async () => {
    await expect(exportBeforeDelete(fakeBb(3), { enabled: true, folder: "  " }, "thr_one", 1000)).rejects.toThrow(/no export folder/);
    await expect(exportBeforeDelete(fakeBb(3, { failGet: true }), { enabled: true, folder }, "thr_one", 1000)).rejects.toThrow("no such thread");
    expect(await readdir(folder)).toEqual([]);
  });

  it("registers only on a BB that asks before deleting", () => {
    let handler: ((context: { threadId: string }) => Promise<void>) | null = null;
    const asking = { ...fakeBb(1), experimental_hooks: { experimental_beforeThreadDelete: (fn: typeof handler) => { handler = fn; } } } as unknown as BbPluginApi;
    expect(registerThreadExportHook(asking, () => ({ enabled: false, folder: "" }))).toBe(true);
    expect(handler).not.toBeNull();
    expect(registerThreadExportHook({ ...fakeBb(1), experimental_hooks: {} } as unknown as BbPluginApi, () => ({ enabled: false, folder: "" }))).toBe(false);
  });
});
