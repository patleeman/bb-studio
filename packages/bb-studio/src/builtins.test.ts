import { describe, expect, it } from "vitest";
import { ARTIFACT_TABLES, ArtifactStore } from "./artifacts/server/store";
import { artifactProvider } from "./artifacts/server/provider";
import { STUDIO_BUILTINS } from "@bb-studio/kit/contract";
import { BUILTIN_PLUGIN_IDS, builtinItemAt, builtinSegment, canonicalPath } from "./builtins";
import { StudioHub, type HubSdk } from "./hub";
import { parseWorkspace } from "./ui/workspace-state";
import Database from "better-sqlite3";

describe("built-in kinds' addresses", () => {
  it("are the ones the kit routes through Studio", () => {
    expect([...BUILTIN_PLUGIN_IDS].sort()).toEqual([...STUDIO_BUILTINS].sort());
  });

  it("reads the Studio address and the old add-on address as the same item", () => {
    const expected = { pluginId: "artifacts", id: "art_1", href: "/plugins/studio/studio/artifacts/art_1" };
    expect(builtinItemAt("/plugins/studio/studio/artifacts/art_1")).toMatchObject(expected);
    expect(builtinItemAt("/plugins/artifacts/artifacts/art_1/")).toMatchObject(expected);
    expect(builtinItemAt("/plugins/studio/studio/artifacts")).toBeNull();
    expect(builtinItemAt("/plugins/pages/pages/pg_1")).toBeNull();
    expect(canonicalPath("/plugins/artifacts/artifacts/art_1?x=1#y")).toBe("/plugins/studio/studio/artifacts/art_1?x=1#y");
    expect(canonicalPath("/plugins/pages/pages/pg_1")).toBe("/plugins/pages/pages/pg_1");
    expect(builtinSegment("artifacts/art_1")).toMatchObject({ route: { kind: "artifact" }, rest: "art_1" });
    expect(builtinSegment("browse")).toBeNull();
  });

  it("maps drawings' old Draw address to Studio", () => {
    expect(builtinItemAt("/plugins/excalidraw/drawings/drw_0123456789abcdef")).toMatchObject({ pluginId: "excalidraw", id: "drw_0123456789abcdef", href: "/plugins/studio/studio/drawings/drw_0123456789abcdef" });
    expect(canonicalPath("/plugins/excalidraw/drawings/drw_1")).toBe("/plugins/studio/studio/drawings/drw_1");
    expect(builtinSegment("drawings")).toMatchObject({ route: { kind: "drawing", pluginId: "excalidraw" }, rest: "" });
  });

  it("maps recordings' old Talk address to Studio, leaving the unsent-audio page alone", () => {
    expect(builtinItemAt("/plugins/talk/recordings/rec_0123456789")).toMatchObject({ pluginId: "talk", id: "rec_0123456789", href: "/plugins/studio/studio/recordings/rec_0123456789" });
    expect(builtinItemAt("/plugins/studio/studio/recordings/unsent")).toBeNull();
    expect(builtinItemAt("/plugins/talk/recordings/unsent")).toBeNull();
    expect(builtinSegment("recordings/unsent")).toMatchObject({ route: { kind: "recording", pluginId: "talk" }, rest: "unsent" });
  });

  it("moves saved workspace tabs off the old address", () => {
    const tab = { href: "/plugins/artifacts/artifacts/art_1", title: "Report" };
    const state = parseWorkspace({ layout: { kind: "pane", id: "p", tabs: [tab], active: tab.href }, focused: "p" });
    expect(state.layout).toMatchObject({ tabs: [{ href: "/plugins/studio/studio/artifacts/art_1", title: "Report" }], active: "/plugins/studio/studio/artifacts/art_1" });
  });
});

describe("the hub with a built-in kind", () => {
  function setup(installed: string[]) {
    const db = new Database(":memory:");
    db.exec(ARTIFACT_TABLES);
    const store = new ArtifactStore(db);
    store.save({ name: "notes.md", mime: "text/markdown", bytes: new Uint8Array(Buffer.from("# Notes")), projectId: null, by: "agent" });
    const calls: string[] = [];
    const sdk: HubSdk = {
      plugins: {
        list: async () => ({ plugins: installed.map((id) => ({ id, name: id, enabled: true, status: "running", statusDetail: null, version: "0.1.0" })) }),
        experimental_discoverRpc: async () => installed.map((pluginId) => ({ pluginId })),
        callRpc: async ({ pluginId, method }) => { calls.push(`${pluginId}.${method}`); throw new Error("no RPC expected"); },
      },
    };
    return { hub: new StudioHub(sdk, [{ pluginId: "artifacts", name: "Artifacts", handlers: artifactProvider({ store, changed: () => {} }) }]), calls };
  }

  it("lists and reads it in-process, and ignores an installed plugin with its old id", async () => {
    const { hub, calls } = setup(["artifacts"]);
    const { providers, items } = await hub.overview();
    expect(providers).toEqual([expect.objectContaining({ pluginId: "artifacts", state: "ready", panel: null })]);
    expect(items).toEqual([expect.objectContaining({ pluginId: "artifacts", kind: "artifact", title: "notes.md", href: expect.stringMatching(/^\/plugins\/studio\/studio\/artifacts\/art_/) })]);
    expect(await hub.get("artifacts", [items[0]!.id])).toHaveLength(1);
    // Inputs are parsed like an RPC call's.
    await expect(hub.call("artifacts", "studio_get", { ids: "nope" } as never)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
