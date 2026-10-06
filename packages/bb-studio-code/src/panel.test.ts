import { describe, expect, it } from "vitest";
import { canEmbedEditor } from "./panel";

describe("where VS Code can show", () => {
  it("embeds only on the computer running BB", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) expect(canEmbedEditor(host)).toBe(true);
    for (const host of ["red4.tailnet.ts.net", "192.168.1.20", "bb.example.com"]) expect(canEmbedEditor(host)).toBe(false);
  });
});
