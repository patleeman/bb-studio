import fs from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import { readFileForTransport } from "./file-read.js";
import { forkReadWithinRoot } from "./file-read.fork.js";

const PNG = Buffer.from("89504e470d0a1a0a0000", "hex");

async function setup() {
  const root = await fs.realpath(await makeTempDir("bb-file-read-root-"));
  const outside = await fs.realpath(await makeTempDir("bb-file-read-out-"));
  await fs.mkdir(path.join(root, "shots"));
  await fs.writeFile(path.join(root, "shots", "a.png"), PNG);
  await fs.writeFile(path.join(outside, "a.png"), Buffer.from("secret"));
  return { root, outside, file: path.join(root, "shots", "a.png") };
}

describe("reading a file inside a root (BB Studio)", () => {
  it("reads a file inside the root as before", async () => {
    const { root, file } = await setup();
    const result = await readFileForTransport({
      followRootSymlink: true,
      resolvedPath: file,
      resultPath: "shots/a.png",
      rootPath: root,
    });
    expect("content" in result && result.content).toBe(PNG.toString("base64"));
  });

  it("refuses a folder swapped for a symlink out of the root after the check", async () => {
    const { root, outside, file } = await setup();
    await fs.rename(path.join(root, "shots"), path.join(root, "shots-old"));
    await fs.symlink(outside, path.join(root, "shots"));
    await expect(
      forkReadWithinRoot(file, { resolvedPath: file, rootPath: root }, 1024),
    ).rejects.toMatchObject({ code: "file_changed" });
  });

  it("refuses a file swapped for a symlink after the check", async () => {
    const { root, outside, file } = await setup();
    await fs.rm(file);
    await fs.symlink(path.join(outside, "a.png"), file);
    await expect(
      forkReadWithinRoot(file, { resolvedPath: file, rootPath: root }, 1024),
    ).rejects.toMatchObject({ code: "ELOOP" });
  });

  it("does not read a file over the size limit", async () => {
    const { root, file } = await setup();
    const read = await forkReadWithinRoot(
      file,
      { resolvedPath: file, rootPath: root },
      4,
    );
    expect(read.stat.size).toBe(PNG.length);
    expect(read.fileContents.length).toBe(0);
    const big = path.join(root, "big.png");
    await fs.writeFile(big, Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(
      readFileForTransport({
        followRootSymlink: true,
        resolvedPath: big,
        resultPath: "big.png",
        rootPath: root,
      }),
    ).rejects.toMatchObject({ code: "file_too_large" });
  });
});
