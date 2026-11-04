import { describe, expect, it } from "vitest";
import type { CanvasItem } from "../shared";
import { shortHeader, tableColumns } from "./items";
import { modelLabel, pickedOf } from "./model-picker";

const table = (data: unknown, options: Record<string, unknown> = {}): CanvasItem => ({ id: "t", kind: "table", title: null, data, options, html: null, size: "m", importance: 3, createdAt: 1, updatedAt: 1, rev: 1 });

describe("canvas tables", () => {
  it("counts a table's columns for the layout", () => {
    expect(tableColumns(table([{ race: "PA", leader: "D", margin: 1.8 }, { race: "AZ", votes: 10 }]))).toBe(4);
    expect(tableColumns(table({ columns: ["a", "b"], rows: [[1, 2]] }))).toBe(2);
    expect(tableColumns(table([{ a: 1, b: 2, c: 3 }], { columns: ["a"] }))).toBe(1);
    expect(tableColumns({ ...table([]), kind: "bar" })).toBe(0);
  });

  it("shortens long headers only when the column is tight", () => {
    expect(shortHeader("Estimated residents", 90)).toBe("Est. Res.");
    expect(shortHeader("Estimated residents", 240)).toBe("Estimated residents");
    expect(shortHeader("Race", 60)).toBe("Race");
    expect(shortHeader("Outstanding ballots", 80)).toBe("Outst. ballots");
    expect(shortHeader("Margin (percentage)", 80)).toBe("Margin (%)");
  });
});

describe("the model picker's state", () => {
  const providers = [{ id: "claude-code", name: "Claude Code", error: null, models: [{ id: "claude-haiku-5-5", name: "Haiku 5.5", isDefault: false, reasoningLevels: [], defaultReasoningLevel: null }] }];
  it("shows the model's listed name, the waiting pick over the current one, and the id when unlisted", () => {
    const execution = { providerId: "claude-code", model: "claude-haiku-5-5", reasoningLevel: null };
    expect(modelLabel(execution, providers)).toBe("Haiku 5.5");
    expect(modelLabel(execution, null)).toBe("claude-haiku-5-5");
    expect(modelLabel(null, providers)).toBe("Model");
    const pending = { providerId: "codex", model: "gpt-6-luna", reasoningLevel: null };
    expect(pickedOf({ execution, pendingExecution: pending })).toBe(pending);
    expect(pickedOf({ execution, pendingExecution: null })).toBe(execution);
    expect(modelLabel(pickedOf({ execution, pendingExecution: pending }), providers)).toBe("gpt-6-luna");
  });
});
