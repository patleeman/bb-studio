import { describe, expect, it } from "vitest";
import { z } from "zod";
import { studioSchemas } from "./contract";

const schemas = studioSchemas(z);
const kind = {
  id: "page", label: "Page", plural: "Pages", icon: "File", columns: [], actions: [],
  create: { mode: "rpc" as const }, canArchive: true, blurb: "Pages",
};

describe("Studio provider contract", () => {
  it("preserves a kind's own-chat opt-out across provider RPC validation", () => {
    expect(schemas.kind.parse({ ...kind, hasOwnChat: true }).hasOwnChat).toBe(true);
    expect(schemas.kind.parse(kind).hasOwnChat).toBeUndefined();
  });
  it("accepts v2 capabilities and rejects other versions", () => {
    expect(schemas.info.safeParse({ pluginId: "pages", version: 1, panel: null, kinds: [kind] }).success).toBe(false);
    const capabilities = { create: true, move: true, archive: true, delete: true, rename: true, duplicate: false, export: true, comments: true, versions: true, links: true };
    const info = { pluginId: "pages", version: 2, panel: "pages", kinds: [{ ...kind, capabilities, mentionProviderId: "page" }] };
    expect(schemas.info.parse(info)).toEqual(info);
  });

  it("round trips get, read and scoped changes", () => {
    expect(schemas.provider.studio_get.input.parse({ ids: ["pg_1"] })).toEqual({ ids: ["pg_1"] });
    expect(schemas.provider.studio_read.input.parse({ id: "pg_1", format: "markdown" })).toEqual({ id: "pg_1", format: "markdown" });
    expect(schemas.provider.studio_read.output.parse({ content: "# Page" })).toEqual({ content: "# Page" });
    expect(schemas.changed.input.parse({ pluginId: "pages", ids: ["pg_1"], removed: ["pg_2"] })).toEqual({ pluginId: "pages", ids: ["pg_1"], removed: ["pg_2"] });
  });
});
