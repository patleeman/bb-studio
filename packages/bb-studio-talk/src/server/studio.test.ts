import { studioSchemas } from "@bb-studio/kit/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { addSegment, memoryStore } from "../test/db";
import { registerStudio, toStudioItem } from "./studio";

function setup() {
  const { store } = memoryStore();
  let handlers: Record<string, (input: unknown) => unknown> = {};
  const bb = { rpc: { register: (_contract: unknown, registered: typeof handlers) => (handlers = registered) } };
  const removed: string[] = [];
  const changed: string[] = [];
  registerStudio(bb as never, studioSchemas(z), {
    store,
    removeAudio: async (id) => void removed.push(id),
    readAudio: async () => Buffer.from("audio"),
    changed: (id) => void changed.push(id),
  });
  const call = async (method: string, input: unknown): Promise<any> => handlers[method]!(input);
  return { store, call, removed, changed };
}

describe("the Talk Studio provider", () => {
  it("exports transcript and audio segments together", async () => {
    const { store, call } = setup();
    store.create({ id: "rec_aaaaaaaa", kind: "recording", projectId: null, threadId: null });
    addSegment(store, "rec_aaaaaaaa", "s1", 0, 1, 1000);
    store.markTranscribed("rec_aaaaaaaa", "s1-0", "Hello team");
    const { files } = await call("studio_export", { id: "rec_aaaaaaaa", format: "bundle" });
    expect(files.map((file: { mime: string }) => file.mime)).toEqual(["text/markdown", expect.stringMatching(/^audio\//)]);
    expect(Buffer.from(files[0].data, "base64").toString()).toContain("Hello team");
  });
  it("describes recordings, which Studio can start, and dictations, which it can't", async () => {
    const { call } = setup();
    const info = await call("studio_describe", null);
    expect(info.kinds.map((kind: { id: string }) => kind.id)).toEqual(["recording", "dictation"]);
    expect(info.kinds[0].create).toEqual({ mode: "event", event: "bb-studio:talk:new-recording" });
    expect(info.kinds[1].create).toBeNull();
    expect(studioSchemas(z).info.parse(info)).toBeTruthy();
  });

  it("lists archived recordings too, with length and word facts", async () => {
    const { store, call } = setup();
    store.create({ id: "rec_aaaaaaaa", kind: "recording", projectId: "proj_a", threadId: null });
    addSegment(store, "rec_aaaaaaaa", "s1", 0, 1, 65_000);
    store.markTranscribed("rec_aaaaaaaa", "s1-0", "Hello there team");
    await call("studio_archive", { ids: ["rec_aaaaaaaa"], archived: true });
    const { items } = await call("studio_list", null);
    expect(items).toMatchObject([
      {
        id: "rec_aaaaaaaa",
        kind: "recording",
        archived: true,
        preview: "Hello there team",
        href: "/plugins/talk/recordings/rec_aaaaaaaa",
        facts: [
          { id: "length", value: "1 min", sort: 65_000 },
          { id: "words", value: "3", sort: 3 },
        ],
      },
    ]);
    // Talk's own list and mentions leave archived recordings out.
    expect(store.list()).toEqual([]);
  });

  it("moves recordings between projects", async () => {
    const { store, call, changed } = setup();
    store.create({ id: "rec_aaaaaaaa", kind: "dictation", projectId: "proj_a", threadId: null });
    expect(await call("studio_move", { ids: ["rec_aaaaaaaa", "rec_missing1"], projectId: null })).toEqual({
      done: ["rec_aaaaaaaa"],
      failed: [{ id: "rec_missing1", error: "Recording not found." }],
    });
    expect(store.recording("rec_aaaaaaaa")!.projectId).toBeNull();
    expect(changed).toEqual(["rec_aaaaaaaa"]);
  });

  it("renames a recording as the user's title", async () => {
    const { store, call, changed } = setup();
    store.create({ id: "rec_aaaaaaaa", kind: "recording", projectId: null, threadId: null });
    expect(await call("studio_rename", { id: "rec_aaaaaaaa", title: "Standup" })).toEqual({ done: ["rec_aaaaaaaa"], failed: [] });
    expect(store.recording("rec_aaaaaaaa")!.title).toBe("Standup");
    // A generated title no longer replaces it.
    expect(store.rename("rec_aaaaaaaa", "Model title", "auto")).toBeNull();
    expect(changed).toEqual(["rec_aaaaaaaa"]);
    expect((await call("studio_rename", { id: "rec_missing1", title: "X" })).failed).toEqual([{ id: "rec_missing1", error: "Recording not found." }]);
  });

  it("won't delete a recording that's still capturing", async () => {
    const { store, call, removed } = setup();
    store.create({ id: "rec_live0000", kind: "recording", projectId: null, threadId: null });
    store.create({ id: "rec_done0000", kind: "recording", projectId: null, threadId: null });
    store.setStatus("rec_done0000", "finishing");
    const result = await call("studio_delete", { ids: ["rec_live0000", "rec_done0000"] });
    expect(result).toEqual({ done: ["rec_done0000"], failed: [{ id: "rec_live0000", error: "Stop the recording before deleting it." }] });
    expect(removed).toEqual(["rec_done0000"]);
    expect(store.recording("rec_done0000")).toBeNull();
  });

  it("copies transcripts", async () => {
    const { store, call } = setup();
    store.create({ id: "rec_aaaaaaaa", kind: "recording", projectId: null, threadId: null });
    addSegment(store, "rec_aaaaaaaa", "s1", 0, 1);
    store.markTranscribed("rec_aaaaaaaa", "s1-0", "One two");
    expect(await call("studio_action", { action: "copy-transcript", ids: ["rec_aaaaaaaa"] })).toEqual({
      message: "Transcript copied",
      text: "One two",
    });
  });

  it("badges recordings that aren't simply done", () => {
    const { store } = setup();
    const recording = store.create({ id: "rec_aaaaaaaa", kind: "recording", projectId: null, threadId: null });
    expect(toStudioItem(recording, "").badge).toEqual({ label: "Recording", tone: "live" });
    expect(toStudioItem({ ...recording, status: "done", failedCount: 2 }, "").badge).toEqual({ label: "2 failed", tone: "danger" });
    expect(toStudioItem({ ...recording, status: "done" }, "").badge).toBeNull();
  });
});
