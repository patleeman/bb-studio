import { describe, expect, it } from "vitest";
import { studioEmbedFor, studioRef, studioSubtitle } from "./schema-config";
import { codeLanguageId } from "./ui/code";

describe("studio embeds", () => {
  it("maps embeds to add-on items and back", () => {
    expect(studioRef("drawing", "drw_1")).toEqual({ pluginId: "excalidraw", id: "drw_1" });
    expect(studioRef("task", "tsk_1")).toEqual({ pluginId: "studio-tasks", id: "tsk_1" });
    expect(studioRef("item", "notes:nt_1:a")).toEqual({ pluginId: "notes", id: "nt_1:a" });
    expect(studioRef("item", "notes:")).toBeNull();
    expect(studioRef("drawing", "")).toBeNull();
    expect(studioRef("page", "pg_1")).toBeNull();
    expect(studioEmbedFor("artifacts", "art_1")).toEqual({ kind: "artifact", target: "art_1" });
    expect(studioEmbedFor("notes", "nt_1")).toEqual({ kind: "item", target: "notes:nt_1" });
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
