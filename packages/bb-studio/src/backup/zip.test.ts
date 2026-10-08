import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { zipFiles } from "../export-zip";
import { extractEntries, readEntry, readZip, safeEntryName, zipDirectory } from "./zip";

const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "studio-zip-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

it("zips a folder by streaming and extracts it byte for byte", async () => {
  const root = await temp();
  const source = join(root, "src");
  await mkdir(join(source, "talk", "audio", "rec_1"), { recursive: true });
  await writeFile(join(source, "manifest.json"), JSON.stringify({ format: "x" }));
  const audio = Buffer.alloc(300_000, 7);
  audio[5] = 1;
  await writeFile(join(source, "talk", "audio", "rec_1", "a.webm"), audio);
  await writeFile(join(source, "talk", "empty.json"), "");
  await writeFile(join(source, "talk", "items.json"), "x".repeat(100_000));
  const out = join(root, "backup.zip");
  expect(await zipDirectory(source, out, "manifest.json")).toMatchObject({ files: 4 });
  const entries = await readZip(out);
  expect(entries[0]!.name).toBe("manifest.json");
  expect(JSON.parse((await readEntry(out, entries[0]!)).toString())).toEqual({ format: "x" });
  const dest = join(root, "dest");
  await extractEntries(out, entries, dest);
  expect((await readFile(join(dest, "talk", "audio", "rec_1", "a.webm"))).equals(audio)).toBe(true);
  expect(await readFile(join(dest, "talk", "items.json"), "utf8")).toBe("x".repeat(100_000));
  expect(await readFile(join(dest, "talk", "empty.json"), "utf8")).toBe("");
});

it("refuses unsafe names before extracting anything", async () => {
  for (const bad of ["../x", "/etc/passwd", "a/../../b", "C:/x", "a\\b", "a//b", "./a", "a/\u0001"]) expect(safeEntryName(bad)).toBe(false);
  expect(safeEntryName("pages/items/pg_1.json")).toBe(true);
  const root = await temp();
  const file = join(root, "evil.zip");
  await writeFile(file, zipFiles([{ name: "ok.json", bytes: Buffer.from("{}") }]));
  // zipFiles rewrites "..", so patch the stored name by hand.
  const bytes = await readFile(file);
  const evil = Buffer.from(bytes.toString("latin1").replaceAll("ok.json", "../x.js"), "latin1");
  await writeFile(file, evil);
  await expect(readZip(file)).rejects.toThrow(/unsafe path/);
});

it("refuses files that aren't archives, oversized archives and corrupted data", async () => {
  const root = await temp();
  const notZip = join(root, "a.zip");
  await writeFile(notZip, "hello, this is not a zip file at all");
  await expect(readZip(notZip)).rejects.toThrow(/isn't a backup file/);

  const big = join(root, "big.zip");
  await writeFile(big, zipFiles([{ name: "a.json", bytes: Buffer.alloc(5000, 1) }]));
  await expect(readZip(big, { maxTotalBytes: 1000, maxEntries: 10 })).rejects.toThrow(/unpacks to more/);

  const corrupt = join(root, "corrupt.zip");
  await writeFile(corrupt, zipFiles([{ name: "a.json", bytes: Buffer.from("{\"a\":1}") }]));
  const entries = await readZip(corrupt);
  const raw = await readFile(corrupt);
  raw[30 + "a.json".length + 1] ^= 0xff;
  await writeFile(corrupt, raw);
  await expect(extractEntries(corrupt, entries, join(root, "out"))).rejects.toThrow();
});

it("refuses to overwrite an existing backup", async () => {
  const root = await temp();
  const source = join(root, "src");
  await mkdir(source);
  await writeFile(join(source, "manifest.json"), "{}");
  const out = join(root, "backup.zip");
  await writeFile(out, "earlier backup");
  await expect(zipDirectory(source, out, "manifest.json")).rejects.toThrow(/already exists/);
  expect(await readFile(out, "utf8")).toBe("earlier backup");
});
