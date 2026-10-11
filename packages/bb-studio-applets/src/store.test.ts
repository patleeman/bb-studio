import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppletStore, safeRelative } from "./store";

const manifest = { id: "hud", name: "HUD", version: "0.1.0", api: 1, capabilities: ["notify", "bb.open"] };

let root: string;
let store: AppletStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "applets-"));
  store = new AppletStore(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("safeRelative", () => {
  it("allows nested paths and rejects escapes and hidden files", () => {
    expect(safeRelative("./js/app.js")).toBe("js/app.js");
    for (const bad of ["../x", "/etc/passwd", "a//b", ".env", "a/../../b", "js\\..\\..\\x"]) expect(safeRelative(bad)).toBeNull();
  });
});

describe("AppletStore", () => {
  it("creates an applet with its manifest and files, all capabilities pending", async () => {
    const info = await store.write("hud", [{ path: "index.html", content: "<h1>hi</h1>" }], manifest);
    expect(info.pending).toEqual(["notify", "bb.open"]);
    expect(await readFile(join(root, "hud", "index.html"), "utf8")).toBe("<h1>hi</h1>");
    expect((await store.list()).map((a) => a.id)).toEqual(["hud"]);
  });

  it("writes nothing when the manifest is invalid", async () => {
    await expect(store.write("hud", [{ path: "index.html", content: "x" }], { ...manifest, api: 9 })).rejects.toThrow(/Invalid manifest/);
    expect(await store.list()).toEqual([]);
  });

  it("needs a manifest to create, and refuses manifest.json as a file", async () => {
    await expect(store.write("hud", [{ path: "index.html", content: "x" }])).rejects.toThrow(/doesn't exist yet/);
    await expect(store.write("hud", [{ path: "manifest.json", content: "{}" }], manifest)).rejects.toThrow(/as `manifest`/);
  });

  it("grants only declared capabilities, re-asks for new ones, and revokes", async () => {
    await store.write("hud", [], manifest);
    const granted = await store.grant("hud", ["notify", "bb.open", "bb.threads.spawn"]);
    expect(granted.granted).toEqual(["bb.open", "notify"]);
    expect(granted.pending).toEqual([]);
    const grown = await store.write("hud", [], { ...manifest, capabilities: [...manifest.capabilities, "clipboard.read"] });
    expect(grown.pending).toEqual(["clipboard.read"]);
    await store.revoke("hud");
    expect((await store.get("hud"))?.granted).toEqual([]);
  });

  it("reports a broken manifest and a folder/id mismatch", async () => {
    await mkdir(join(root, "broken"));
    await writeFile(join(root, "broken", "manifest.json"), "{");
    await mkdir(join(root, "other"));
    await writeFile(join(root, "other", "manifest.json"), JSON.stringify(manifest));
    const [broken, other] = await store.list();
    expect(broken?.manifest).toBeNull();
    expect(other?.errors[0]).toMatch(/doesn't match the folder name/);
  });

  it("rejects invalid ids", () => {
    expect(() => store.dir("../x")).toThrow(/Invalid applet id/);
  });
});
