import { appendFileSync, chmodSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installStub, waitFor } from "../test/tap-fixture";
import { HelperError, TapHelper, parseHashFile, platformSupport } from "./tap-helper";
import { LineSplitter, captureArgv, parseTapLine, type TapEvent } from "./tap-protocol";

describe("the helper's protocol", () => {
  it("parses each event and ignores what it doesn't know", () => {
    expect(parseTapLine('{"event":"started","sources":["them","me"]}')).toEqual({ event: "started", sources: ["them", "me"] });
    expect(parseTapLine('{"event":"segment","source":"me","index":3,"path":"/tmp/a.wav","startMs":100,"endMs":8100}')).toMatchObject({ event: "segment", index: 3 });
    expect(parseTapLine('{"event":"final","source":"them","index":0,"text":"Hi","startMs":0,"endMs":5}')).toMatchObject({ text: "Hi" });
    expect(parseTapLine('{"event":"error","code":"permission","message":"no"}')).toMatchObject({ code: "permission" });
    expect(parseTapLine('{"event":"model","progress":0.4,"stage":"download"}')).toEqual({ event: "model", progress: 0.4, stage: "download" });
    expect(parseTapLine('{"event":"level","source":"them","rms":2}')).toBeNull();
    expect(parseTapLine('{"event":"segment","source":"left","index":0}')).toBeNull();
    expect(parseTapLine("not json")).toBeNull();
    expect(parseTapLine("   ")).toBeNull();
  });

  it("builds capture's argv, with --fake only when asked", () => {
    const args = { target: { all: true as const }, mic: true, segmentDir: "/x", segmentTargetMs: 8000, segmentMaxMs: 15000, stt: { kind: "none" as const } };
    expect(captureArgv(args)).toEqual(["capture", "--json-args", JSON.stringify(args)]);
    expect(captureArgv(args, { them: "/t.wav", me: "/m.wav" }).slice(3)).toEqual(["--fake", "/t.wav", "/m.wav"]);
    expect(captureArgv(args, { them: "/t.wav", me: "/m.wav", speed: 4 }).slice(3)).toEqual(["--fake", "/t.wav", "/m.wav", "--fake-speed", "4"]);
  });

  it("splits a stream into lines across chunks", () => {
    const lines = new LineSplitter();
    expect(lines.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(lines.push(':2}\n')).toEqual(['{"b":2}']);
    expect(lines.push("tail")).toEqual([]);
    expect(lines.flush()).toEqual(["tail"]);
  });

  it("reads the hash file in shasum's format", () => {
    const hex = "a".repeat(64);
    expect(parseHashFile(`${hex}  bb-talk-tap\n`)).toBe(hex);
    expect(parseHashFile(hex.toUpperCase())).toBe(hex);
    expect(parseHashFile("abc")).toBeNull();
  });

  it("needs macOS 14.2 or later", () => {
    expect(platformSupport("darwin", "23.2.0")).toBeNull();
    expect(platformSupport("darwin", "25.6.0")).toBeNull();
    expect(platformSupport("darwin", "23.1.0")).toMatch(/14\.2/);
    expect(platformSupport("darwin", "22.6.0")).toMatch(/14\.2/);
    expect(platformSupport("linux", "6.1.0")).toMatch(/Mac/);
  });
});

describe("the hash check", () => {
  it("runs a helper that matches its checksum", async () => {
    const stub = installStub();
    const helper = new TapHelper({ path: stub.path });
    await expect(helper.verify()).resolves.toBeUndefined();
    expect(await helper.permission()).toBe("granted");
    expect((await helper.apps()).map((app) => app.name)).toContain("zoom.us");
  });

  it("refuses a helper whose bytes changed, and never runs it", async () => {
    const stub = installStub();
    appendFileSync(stub.path, "\n// tampered\n");
    const helper = new TapHelper({ path: stub.path });
    await expect(helper.verify()).rejects.toMatchObject({ code: "hash" });
    await expect(helper.apps()).rejects.toBeInstanceOf(HelperError);
    expect(stub.log()).toEqual([]);
  });

  it("refuses a helper with no checksum or a broken one", async () => {
    const stub = installStub();
    unlinkSync(`${stub.path}.sha256`);
    await expect(new TapHelper({ path: stub.path }).verify()).rejects.toMatchObject({ code: "hash" });
    writeFileSync(`${stub.path}.sha256`, "not a hash");
    await expect(new TapHelper({ path: stub.path }).verify()).rejects.toMatchObject({ code: "hash" });
  });

  it("says so when the helper isn't there", async () => {
    const stub = installStub();
    await expect(new TapHelper({ path: join(stub.root, "nope") }).verify()).rejects.toMatchObject({ code: "missing" });
  });

  it("gives back a lost executable bit", async () => {
    const stub = installStub();
    chmodSync(stub.path, 0o644);
    await new TapHelper({ path: stub.path }).verify();
    expect(statSync(stub.path).mode & 0o111).not.toBe(0);
  });
});

describe("capture", () => {
  it("streams events in order and stops on request", async () => {
    const stub = installStub({
      steps: [
        { at: 0, event: "started", sources: ["them", "me"] },
        { at: 5, event: "level", source: "them", rms: 0.4 },
        { at: 10, event: "segment", source: "them", index: 0, startMs: 0, endMs: 8000 },
        { at: 15, event: "final", source: "them", index: 0, text: "Hello there", startMs: 0, endMs: 8000 },
      ],
    });
    const dir = join(stub.root, "incoming");
    mkdirSync(dir);
    const helper = new TapHelper({ path: stub.path, fake: stub.fake });
    const events: TapEvent[] = [];
    const handle = await helper.capture(
      { target: { bundleIds: ["us.zoom.xos"] }, mic: true, segmentDir: dir, segmentTargetMs: 8000, segmentMaxMs: 15000, stt: { kind: "whisperkit", model: "m", modelDir: "/models" } },
      (event) => events.push(event),
    );
    await waitFor(() => events.some((event) => event.event === "final"));
    await handle.stop();
    expect(events.map((event) => event.event)).toEqual(["started", "level", "segment", "final", "stopped"]);
    const segment = events[2] as Extract<TapEvent, { event: "segment" }>;
    expect(segment.path).toBe(join(dir, "them-00000.wav"));
    const [run, stop] = stub.log();
    expect(run!.argv!.slice(0, 2)).toEqual(["capture", "--json-args"]);
    expect(JSON.parse(run!.argv![2]!)).toMatchObject({ target: { bundleIds: ["us.zoom.xos"] }, stt: { kind: "whisperkit" } });
    expect(run!.argv!.slice(3)).toEqual(["--fake", stub.fake.them, stub.fake.me]);
    expect(stop!.stdin).toEqual({ cmd: "stop" });
    expect(await handle.exited).toEqual({ code: 0, signal: null });
  });

  it("ends a helper that ignores stop", async () => {
    const stub = installStub({ steps: [{ at: 0, event: "started", sources: ["them"] }] });
    // Swap in a helper that never reads stdin, with its checksum.
    writeFileSync(stub.path, "#!/usr/bin/env node\nprocess.stdout.write('{\"event\":\"started\",\"sources\":[\"them\"]}\\n');\nprocess.stdin.pause();\nsetInterval(() => {}, 1000);\n");
    const { createHash } = await import("node:crypto");
    const { readFileSync } = await import("node:fs");
    writeFileSync(`${stub.path}.sha256`, createHash("sha256").update(readFileSync(stub.path)).digest("hex"));
    const helper = new TapHelper({ path: stub.path, fake: stub.fake });
    const handle = await helper.capture({ target: { all: true }, mic: false, segmentDir: stub.root, segmentTargetMs: 8000, segmentMaxMs: 15000, stt: { kind: "none" } }, () => {});
    await handle.stop(200);
    expect((await handle.exited).signal).toBe("SIGTERM");
  });
});
