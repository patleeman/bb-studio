import { describe, expect, it } from "vitest";
import { parseStudioItemHref, parseStudioItemReference, parseStudioMentionReference, studioTextReferences } from "./references";

describe("canonical Studio references", () => {
  it("preserves opaque percent escapes and colons in raw references and mentions", () => {
    expect(parseStudioItemReference("item:custom:opaque:50%2F%broken")).toEqual({ pluginId: "custom", id: "opaque:50%2F%broken" });
    expect(parseStudioMentionReference("custom", "opaque:50%2F%broken")).toEqual({ pluginId: "custom", id: "opaque:50%2F%broken" });
    expect(parseStudioMentionReference("studio", "item:custom:opaque:50%2F")).toEqual({ pluginId: "custom", id: "opaque:50%2F" });
  });
  it("strips only known legacy or declared mention namespaces, longest first", () => {
    expect(parseStudioMentionReference("pages", "page:pg_1")).toEqual({ pluginId: "pages", id: "pg_1" });
    const providers = [{ pluginId: "custom", kinds: [{ mentionProviderId: "objects" }, { mentionProviderId: "objects:child" }] }];
    expect(parseStudioMentionReference("custom", "objects:child:part:50%", providers)).toEqual({ pluginId: "custom", id: "part:50%" });
    expect(parseStudioMentionReference("other", "objects:child:part", providers)).toEqual({ pluginId: "other", id: "objects:child:part" });
    expect(parseStudioMentionReference("custom", "objects:", providers)).toBeNull();
  });
  it("decodes URL segments once and rejects malformed encodings and undeclared routes", () => {
    expect(parseStudioItemHref("/plugins/pages/pages/a%253Ab%252F?q=x#section")).toEqual({ pluginId: "pages", id: "a%3Ab%2F" });
    expect(parseStudioItemHref("/plugins/pages/pages/a%3Ab%2Fc")).toEqual({ pluginId: "pages", id: "a:b/c" });
    for (const path of ["/plugins/pages/pages/a%", "/plugins/pages/pages/%ZZ", "/plugins/pages/settings/pg_1", "/plugins/custom/objects/a", "/plugins/pages/pages/a/unknown"]) expect(parseStudioItemHref(path)).toBeNull();
    expect(parseStudioItemHref("/plugins/custom/objects/a%3Ab", { routes: [{ pluginId: "custom", path: "/plugins/custom/objects/" }] })).toEqual({ pluginId: "custom", id: "a:b" });
    expect(parseStudioItemHref("/plugins/bot-teams/bots/bot_1/profile")).toEqual({ pluginId: "bot-teams", id: "bot_1" });
  });
  it("requires a matching origin for absolute and protocol-relative links", () => {
    const options = { origin: "https://bb.example" };
    const local = "https://bb.example/plugins/pages/pages/pg_1";
    expect(parseStudioItemHref(local)).toBeNull();
    expect(parseStudioItemHref(local, options)).toEqual({ pluginId: "pages", id: "pg_1" });
    for (const url of ["https://evil.example/plugins/pages/pages/pg_1", "//evil.example/plugins/pages/pages/pg_1", "https://bb.example.evil/plugins/pages/pages/pg_1", "https://user@bb.example/plugins/pages/pages/pg_1"]) expect(parseStudioItemHref(url, options)).toBeNull();
  });
  it("reads whole colon IDs without rescuing inner paths from rejected external URLs", () => {
    const text = "@[Custom](item:custom:opaque:50%2F) [Local](/plugins/pages/pages/pg_1) https://evil.example/plugins/pages/pages/pg_2 <https://bb.example/plugins/pages/pages/pg_3> ftp://evil.example/plugins/pages/pages/pg_4";
    expect(studioTextReferences(text, { origin: "https://bb.example" })).toEqual([
      { ref: { pluginId: "custom", id: "opaque:50%2F" }, kind: "mention" },
      { ref: { pluginId: "pages", id: "pg_1" }, kind: "link" },
      { ref: { pluginId: "pages", id: "pg_3" }, kind: "link" },
    ]);
  });
  it("maps built-in kinds' Studio mentions and addresses, old and new, to their item namespace", () => {
    expect(parseStudioMentionReference("studio", "artifact:art_1")).toEqual({ pluginId: "artifacts", id: "art_1" });
    expect(parseStudioMentionReference("artifacts", "artifact:art_1")).toEqual({ pluginId: "artifacts", id: "art_1" });
    expect(parseStudioItemHref("/plugins/studio/studio/artifacts/art_1")).toEqual({ pluginId: "artifacts", id: "art_1" });
    expect(parseStudioItemHref("/plugins/artifacts/artifacts/art_1")).toEqual({ pluginId: "artifacts", id: "art_1" });
    expect(parseStudioMentionReference("studio", "drawing:drw_1")).toEqual({ pluginId: "excalidraw", id: "drw_1" });
    expect(parseStudioItemHref("/plugins/studio/studio/drawings/drw_1")).toEqual({ pluginId: "excalidraw", id: "drw_1" });
    expect(parseStudioItemHref("/plugins/excalidraw/drawings/drw_1")).toEqual({ pluginId: "excalidraw", id: "drw_1" });
    expect(parseStudioMentionReference("studio", "design:dsn_1")).toEqual({ pluginId: "design", id: "dsn_1" });
    expect(parseStudioItemHref("/plugins/studio/studio/designs/dsn_1")).toEqual({ pluginId: "design", id: "dsn_1" });
    expect(parseStudioItemHref("/plugins/design/designs/dsn_1")).toEqual({ pluginId: "design", id: "dsn_1" });
    expect(parseStudioItemHref("/plugins/studio/studio/browse")).toBeNull();
  });
});
