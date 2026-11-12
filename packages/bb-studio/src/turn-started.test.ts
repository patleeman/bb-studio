import { expect, it } from "vitest";
import { openTurnStart } from "./turn-started";

type Rows = Parameters<typeof openTurnStart>[0];
const rows = (value: unknown[]) => value as unknown as Rows;

it("finds the open turn's start: an open turn row, or the first row after the last finished turn", () => {
  expect(openTurnStart(rows([{ kind: "turn", createdAt: 1, completedAt: 2 }, { kind: "turn", createdAt: 5, completedAt: null }]))).toBe(5);
  expect(openTurnStart(rows([{ kind: "turn", createdAt: 1, completedAt: 2 }, { kind: "conversation", createdAt: 7 }, { kind: "work", createdAt: 9 }]))).toBe(7);
  expect(openTurnStart(rows([{ kind: "conversation", createdAt: 3 }, { kind: "work", createdAt: 4 }]))).toBe(3);
  expect(openTurnStart(rows([{ kind: "turn", createdAt: 1, completedAt: 2 }]))).toBeNull();
  expect(openTurnStart(rows([]))).toBeNull();
});
