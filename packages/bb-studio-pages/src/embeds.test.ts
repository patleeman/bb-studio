import { describe, expect, it } from "vitest";
import { boardTarget, parseBoardTarget, studioEmbedFor, studioRef, studioSubtitle } from "./schema-config";
import { codeLanguageId } from "./ui/code";

describe("studio embeds", () => {
  it("maps embeds to add-on items and back", () => {
    expect(studioRef("drawing", "drw_1")).toEqual({ pluginId: "excalidraw", id: "drw_1" });
    expect(studioRef("task", "tsk_1")).toEqual({ pluginId: "studio", id: "tsk_1" });
    expect(studioRef("item", "notes:nt_1:a")).toEqual({ pluginId: "notes", id: "nt_1:a" });
    expect(studioRef("item", "notes:")).toBeNull();
    expect(studioRef("drawing", "")).toBeNull();
    expect(studioRef("table", "tbl_1/view/view_2")).toEqual({ pluginId: "studio", id: "tbl_1" });
    expect(studioRef("page", "pg_1")).toBeNull();
    expect(studioEmbedFor("artifacts", "art_1")).toEqual({ kind: "artifact", target: "art_1" });
    expect(studioEmbedFor("studio-tables", "tbl_1")).toEqual({ kind: "table", target: "tbl_1" });
    expect(studioEmbedFor("notes", "nt_1")).toEqual({ kind: "item", target: "notes:nt_1" });
  });

  it("tells a Tasks board from a task", () => {
    expect(studioEmbedFor("studio-tasks", "tsk_0123456789abcdef")).toEqual({ kind: "task", target: "tsk_0123456789abcdef" });
    expect(studioEmbedFor("studio-tasks", "brd_0123456789abcdef")).toEqual({ kind: "board", target: "brd_0123456789abcdef" });
    expect(studioRef("board", "brd_1/view/list")).toEqual({ pluginId: "studio", id: "brd_1" });
  });

  it("keeps a board embed's view in its target", () => {
    expect(parseBoardTarget("brd_1")).toEqual({ boardId: "brd_1", view: "board" });
    expect(parseBoardTarget("brd_1/view/list")).toEqual({ boardId: "brd_1", view: "list" });
    // A view the embed can't show falls back to the board.
    expect(parseBoardTarget("brd_1/view/calendar")).toEqual({ boardId: "brd_1", view: "board" });
    expect(boardTarget("brd_1", "list")).toBe("brd_1/view/list");
    expect(boardTarget("brd_1", "board")).toBe("brd_1");
  });
});

describe("codeLanguageId", () => {
  it("maps fence languages to the picker's ids", () => {
    expect(codeLanguageId("ts")).toBe("typescript");
    expect(codeLanguageId("Python")).toBe("python");
    expect(codeLanguageId("bash")).toBe("shellscript");
    expect(codeLanguageId("brainfuck")).toBe("text");
    expect(codeLanguageId("")).toBe("text");
  });
});

describe("studioSubtitle", () => {
  it("drops repeats and bare counts", () => {
    const item = { kindLabel: "Task", badge: "In progress", facts: ["In progress", "Oct 6", "9", "Agent"] };
    expect(studioSubtitle(item)).toBe("Task · In progress · Oct 6 · Agent");
  });
});
