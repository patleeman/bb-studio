import { describe, expect, it } from "vitest";
import { newCapabilities, parseManifest } from "./manifest";

const hud = {
  id: "hud",
  name: "Thread HUD",
  version: "0.1.0",
  api: 1,
  windows: { main: { kind: "overlay", width: 320, height: 200, position: "top-right" } },
  capabilities: ["window.overlay", "shortcut.global", "bb.threads.read", "bb.rpc:pages:pages.list"],
  shortcuts: { toggle: "Alt+Space" },
};

describe("parseManifest", () => {
  it("accepts the HUD manifest and fills defaults", () => {
    const result = parseManifest(hud);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.entry).toBe("index.html");
  });

  it("rejects unknown capabilities and a newer API", () => {
    const result = parseManifest({ ...hud, api: 2, capabilities: [...hud.capabilities, "shell.exec"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/api[\s\S]*capabilities\.4: unknown capability/);
  });

  it("requires the capability for each window kind and for shortcuts", () => {
    const result = parseManifest({ ...hud, capabilities: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual(["windows.main: needs the window.overlay capability", "shortcuts: needs the shortcut.global capability"]);
  });

  it("keeps the entry inside the folder and rejects extra keys", () => {
    expect(parseManifest({ ...hud, entry: "../x.html" }).ok).toBe(false);
    expect(parseManifest({ ...hud, node: true }).ok).toBe(false);
  });
});

describe("newCapabilities", () => {
  it("lists what isn't granted yet", () => {
    expect(newCapabilities(["notify", "bb.open"], ["notify"])).toEqual(["bb.open"]);
  });
});
