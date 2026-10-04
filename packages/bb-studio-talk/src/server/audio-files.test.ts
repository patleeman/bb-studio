import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { AudioFiles } from "./audio-files";

test("concurrent retries of the same audio segment use independent temporary files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "talk-audio-files-"));
  try {
    const files = new AudioFiles(directory);
    const audio = Buffer.from("the same recorded segment");
    const paths = await Promise.all(Array.from({ length: 20 }, () => files.write("rec_1", "session-0", "audio/webm", audio)));
    expect(new Set(paths).size).toBe(1);
    expect(await files.read(paths[0]!)).toEqual(audio);
    expect(await readdir(join(files.root, "rec_1"))).toEqual(["session-0.webm"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
