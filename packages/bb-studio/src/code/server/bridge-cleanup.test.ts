import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Bridges } from "./bridge";

const failure = vi.hoisted(() => ({ suffix: "", paths: [] as string[] }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, chmod: async (...args: Parameters<typeof fs.chmod>) => {
    failure.paths.push(String(args[0]));
    if (failure.suffix && String(args[0]).endsWith(failure.suffix)) throw new Error("chmod rejected");
    return fs.chmod(...args);
  } };
});

it.each([".token", ".sock"])("cleans partial bridge setup when chmod of %s fails", async (suffix) => {
  const dir = await mkdtemp(join(tmpdir(), "scb-clean-"));
  const bridges = new Bridges();
  try {
    failure.suffix = suffix;
    failure.paths = [];
    await expect(bridges.open("ws", dir)).rejects.toThrow("chmod rejected");
    expect(await readdir(dir)).toEqual([]);
    for (const path of failure.paths) await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    failure.suffix = "";
    await bridges.open("ws", dir);
  } finally {
    failure.suffix = "";
    await bridges.closeAll();
    for (const path of failure.paths) await rm(path, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
