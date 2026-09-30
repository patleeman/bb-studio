import { describe, expect, it } from "vitest";
import { linkEmbed } from "./links";

const ORIGIN = "http://127.0.0.1:38886";

describe("linkEmbed", () => {
  it("makes a bookmark of a web link", () => {
    expect(linkEmbed("  https://example.com/post?id=1 \n", ORIGIN)).toEqual({ kind: "bookmark", target: "https://example.com/post?id=1" });
  });

  it("makes page and thread cards of BB links", () => {
    expect(linkEmbed(`${ORIGIN}/plugins/pages/pages/pg_0123456789ab`, ORIGIN)).toEqual({ kind: "page", target: "pg_0123456789ab" });
    expect(linkEmbed(`${ORIGIN}/projects/proj_a/threads/thr_abc123`, ORIGIN)).toEqual({ kind: "thread", target: "thr_abc123" });
  });

  it("makes Studio cards of add-on item links", () => {
    expect(linkEmbed(`${ORIGIN}/plugins/excalidraw/drawings/drw_1`, ORIGIN)).toEqual({ kind: "drawing", target: "drw_1" });
    expect(linkEmbed(`${ORIGIN}/plugins/artifacts/artifacts/art_0123456789abcdef`, ORIGIN)).toEqual({ kind: "artifact", target: "art_0123456789abcdef" });
    expect(linkEmbed(`${ORIGIN}/plugins/talk/recordings/rec_1/`, ORIGIN)).toEqual({ kind: "recording", target: "rec_1" });
    expect(linkEmbed(`${ORIGIN}/plugins/studio-tasks/tasks/tsk_1`, ORIGIN)).toEqual({ kind: "task", target: "tsk_1" });
    // Another app's link, or an unknown panel, stays a bookmark.
    expect(linkEmbed("https://other.dev/plugins/excalidraw/drawings/drw_1", ORIGIN)?.kind).toBe("bookmark");
    expect(linkEmbed(`${ORIGIN}/plugins/excalidraw/settings/x`, ORIGIN)?.kind).toBe("bookmark");
  });

  it("leaves text, other schemes and several links alone", () => {
    expect(linkEmbed("see https://example.com", ORIGIN)).toBeNull();
    expect(linkEmbed("https://a.com https://b.com", ORIGIN)).toBeNull();
    expect(linkEmbed("mailto:me@example.com", ORIGIN)).toBeNull();
    expect(linkEmbed("example.com", ORIGIN)).toBeNull();
  });
});
