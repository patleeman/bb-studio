import { describe, expect, it } from "vitest";
import { installStub, piece, waitFor } from "../test/tap-fixture";

describe("call recording over Talk's RPC", () => {
  it("reads the notice, starts from a source, merges both sides live, and stops", async () => {
    const stub = installStub({
      apps: [{ bundleId: "us.zoom.xos", name: "zoom.us", pid: 1, playing: true }],
      steps: [
        { at: 0, event: "started", sources: ["them", "me"] },
        ...piece("them", 0, 0, 6_000, "Shall we start with the launch date?", 20),
        ...piece("me", 0, 6_200, 9_000, "Yes, the twelfth.", 40),
      ],
    });
    process.env.BB_STUDIO_TALK_TAP = stub.path;
    process.env.BB_STUDIO_TALK_TAP_FAKE = stub.fakeDir;
    const { talkHost } = await import("../test/host");
    const { call } = await talkHost();

    expect(await call("recordings.call_status", null)).toEqual({ active: null, consented: false });
    const sources = await call("recordings.call_sources", null);
    expect(sources).toMatchObject({ supported: true, permission: "granted", apps: [{ name: "zoom.us", playing: true }] });
    await expect(call("recordings.call_start", { target: { bundleIds: ["us.zoom.xos"] }, app: "zoom.us", mic: true })).rejects.toThrow(/notice/);
    expect(await call("recordings.call_consent", null)).toEqual({ consented: true });

    const recording = await call("recordings.call_start", { target: { bundleIds: ["us.zoom.xos"] }, app: "zoom.us", mic: true });
    expect(recording.call).toMatchObject({ app: "zoom.us", stt: "whisperkit" });
    expect((await call("recordings.call_status", null)).active).toMatchObject({ recordingId: recording.id, app: "zoom.us" });
    // A recording being captured can't be deleted.
    await expect(call("recordings.recording_delete", { id: recording.id })).rejects.toThrow(/Stop the recording/);

    let segments: { speaker: string; text: string }[] = [];
    await waitFor(() => {
      void call("recordings.recording_get", { id: recording.id }).then((result) => { segments = result.segments; });
      return segments.filter((segment) => segment.text).length === 2;
    });
    expect(segments.map((segment) => [segment.speaker, segment.text])).toEqual([["them", "Shall we start with the launch date?"], ["me", "Yes, the twelfth."]]);

    const stopped = await call("recordings.call_stop", { id: recording.id });
    expect(stopped.status).toBe("done");
    expect((await call("recordings.call_status", null)).active).toBeNull();
    expect(JSON.parse(stub.log()[2]!.argv![2]!)).toMatchObject({ target: { bundleIds: ["us.zoom.xos"] } });
    expect(stub.log()[2]!.argv).toContain("--fake");
    expect(await call("recordings.recording_delete", { id: recording.id })).toEqual({ deleted: true });
  });
});
