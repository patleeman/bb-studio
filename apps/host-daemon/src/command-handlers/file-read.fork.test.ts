import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readFileChunkForTransport,
  readFileForTransport,
} from "./file-read.js";
import {
  forkReadError,
  forkReadWithinRoot,
  openRefusingSymlinks,
} from "./file-read.fork.js";

const PNG = Buffer.from("89504e470d0a1a0a0000", "hex");
const FLIP = `
const fs = require("node:fs");
const [root, ms] = process.argv.slice(1);
const shots = root + "/shots", real = root + "/shots-real", link = root + "/shots-link";
const end = Date.now() + Number(ms);
while (Date.now() < end) {
  try { fs.renameSync(shots, real); fs.renameSync(link, shots); } catch {}
  try { fs.renameSync(shots, link); fs.renameSync(real, shots); } catch {}
}
`;

async function setup() {
  const root = await fs.realpath(await makeTempDir("bb-file-read-root-"));
  const outside = await fs.realpath(await makeTempDir("bb-file-read-out-"));
  await fs.mkdir(path.join(root, "shots"));
  await fs.writeFile(path.join(root, "shots", "a.png"), PNG);
  await fs.writeFile(path.join(outside, "a.png"), Buffer.from("secret"));
  return { root, outside, file: path.join(root, "shots", "a.png") };
}

function rooted(root: string, file: string) {
  return {
    followRootSymlink: true,
    resolvedPath: file,
    resultPath: path.relative(root, file),
    rootPath: root,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reading a file inside a root (BB Studio)", () => {
  it("reads a file inside the root as before", async () => {
    const { root, file } = await setup();
    const result = await readFileForTransport(rooted(root, file));
    expect("content" in result && result.content).toBe(PNG.toString("base64"));
  });

  it.runIf(process.platform === "darwin")(
    "refuses a folder in the path that is a symlink at the open itself",
    async () => {
      const { root, outside, file } = await setup();
      await fs.rename(path.join(root, "shots"), path.join(root, "shots-old"));
      await fs.symlink(outside, path.join(root, "shots"));
      await expect(openRefusingSymlinks(file)).rejects.toMatchObject({
        code: "ELOOP",
      });
    },
  );

  it("refuses a folder swapped for a symlink out of the root, without naming the real path", async () => {
    const { root, outside, file } = await setup();
    await fs.rename(path.join(root, "shots"), path.join(root, "shots-old"));
    await fs.symlink(outside, path.join(root, "shots"));
    const error = await forkReadWithinRoot(
      file,
      { resolvedPath: file, resultPath: "shots/a.png", rootPath: root },
      1024,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "file_changed",
      message: "File changed during read",
      name: "ExpectedCommandDispatchError",
    });
  });

  it("refuses a file swapped for a symlink after the check", async () => {
    const { root, outside, file } = await setup();
    await fs.rm(file);
    await fs.symlink(path.join(outside, "a.png"), file);
    await expect(
      forkReadWithinRoot(
        file,
        { resolvedPath: file, resultPath: "shots/a.png", rootPath: root },
        1024,
      ),
    ).rejects.toMatchObject({
      code: "file_changed",
      message: "File changed during read",
    });
  });

  it.skipIf(process.platform === "win32")(
    "never reads the outside file while a folder in the path flips to a symlink and back",
    async () => {
      const { root, outside, file } = await setup();
      await fs.symlink(outside, path.join(root, "shots-link"));
      const flipper = spawn(process.execPath, ["-e", FLIP, root, "4000"], {
        stdio: "ignore",
      });
      const counts = { inside: 0, outside: 0, refused: 0 };
      const end = Date.now() + 3000;
      try {
        while (Date.now() < end) {
          try {
            const readable = await fs.realpath(file);
            if (!readable.startsWith(`${root}/`)) {
              counts.refused += 1;
              continue;
            }
            const bytes =
              (counts.inside + counts.refused) % 2 === 0
                ? (
                    await forkReadWithinRoot(
                      readable,
                      {
                        resolvedPath: file,
                        resultPath: "shots/a.png",
                        rootPath: root,
                      },
                      1024,
                    )
                  ).fileContents
                : Buffer.from(
                    (
                      await readFileChunkForTransport({
                        ...rooted(root, file),
                        offset: 0,
                        length: 64,
                        revision: null,
                      })
                    ).content,
                    "base64",
                  );
            if (bytes.equals(PNG)) counts.inside += 1;
            else counts.outside += 1;
          } catch {
            counts.refused += 1;
          }
        }
      } finally {
        flipper.kill();
        await new Promise((resolve) => flipper.once("exit", resolve));
      }
      expect(counts.outside).toBe(0);
      expect(counts.inside + counts.refused).toBeGreaterThan(100);
    },
    15_000,
  );

  it("reads a symlinked file when there is no root, as upstream does", async () => {
    const dir = await fs.realpath(await makeTempDir("bb-file-read-noroot-"));
    await fs.writeFile(path.join(dir, "target.txt"), "hello");
    await fs.symlink(path.join(dir, "target.txt"), path.join(dir, "dotfile"));
    const result = await readFileForTransport({
      followRootSymlink: false,
      resolvedPath: path.join(dir, "dotfile"),
      resultPath: path.join(dir, "dotfile"),
    });
    expect("content" in result && result.content).toBe("hello");
  });

  it("refuses a rooted folder with the usual error", async () => {
    const { root } = await setup();
    await expect(
      readFileForTransport(rooted(root, path.join(root, "shots"))),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("reads a chunk inside the root through the same safe open", async () => {
    const { root, file } = await setup();
    const chunk = await readFileChunkForTransport({
      ...rooted(root, file),
      offset: 0,
      length: 4,
      revision: null,
    });
    expect(chunk.content).toBe(PNG.subarray(0, 4).toString("base64"));
  });

  it("does not read a file over the size limit", async () => {
    const { root, file } = await setup();
    const read = await forkReadWithinRoot(
      file,
      { resolvedPath: file, resultPath: "shots/a.png", rootPath: root },
      4,
    );
    expect(read.stat.size).toBe(PNG.length);
    expect(read.fileContents.length).toBe(0);
    const big = path.join(root, "big.png");
    await fs.writeFile(big, Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(readFileForTransport(rooted(root, big))).rejects.toMatchObject(
      { code: "file_too_large" },
    );
  });

  it("refuses a file that grows during the read", async () => {
    const { root, file } = await setup();
    const handle = await fs.open(file);
    const proto = Object.getPrototypeOf(handle) as fs.FileHandle;
    await handle.close();
    const realRead = proto.read;
    let grown = false;
    vi.spyOn(proto, "read").mockImplementation(async function (
      this: fs.FileHandle,
      ...args: unknown[]
    ) {
      if (!grown) {
        grown = true;
        await fs.appendFile(file, Buffer.from("more"));
      }
      return (realRead as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    await expect(
      forkReadWithinRoot(
        file,
        { resolvedPath: file, resultPath: "shots/a.png", rootPath: root },
        1024,
      ),
    ).rejects.toMatchObject({ code: "file_changed" });
    grown = false;
    await fs.writeFile(file, PNG);
    await expect(
      forkReadWithinRoot(
        file,
        { resolvedPath: file, resultPath: "shots/a.png", rootPath: root },
        PNG.length,
      ),
    ).rejects.toMatchObject({ code: "file_too_large" });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses a rooted file it may not read without naming the real path",
    async () => {
      const { root, file } = await setup();
      await fs.chmod(file, 0o000);
      try {
        const error = await readFileForTransport(rooted(root, file)).catch(
          (caught: unknown) => caught,
        );
        expect(error).toMatchObject({
          code: "invalid_path",
          message: 'Path "shots/a.png" can\'t be read',
          name: "ExpectedCommandDispatchError",
        });
      } finally {
        await fs.chmod(file, 0o644);
      }
    },
  );

  it("maps a realpath EINVAL during a flip to file_changed with no path", () => {
    const raw = Object.assign(
      new Error("EINVAL: invalid argument, realpath '/private/real/path'"),
      { code: "EINVAL" },
    );
    expect(() => forkReadError({ resultPath: "a.png" })(raw)).toThrow(
      expect.objectContaining({
        code: "file_changed",
        message: "File changed during read",
      }),
    );
    const other = new Error("boom");
    expect(() => forkReadError({ resultPath: "a.png" })(other)).toThrow(other);
  });
});
