import { expect, it, vi } from "vitest";
import { mainChoices, shownMain } from "./MainPicker";

vi.mock("../live", () => ({ useCall: () => vi.fn(), useLive: () => ({ data: null, refresh: () => {} }) }));

const row = (threadId: string, title: string, extra: { isMain?: boolean; archivedAt?: number | null } = {}) => ({ threadId, title, isMain: false, archivedAt: null, ...extra });

it("lists the Bot's active conversations, the Main first; archived ones can't be the Main", () => {
  const choices = mainChoices([row("b", "Budget"), row("m", "Dot", { isMain: true }), row("a", "Archived", { archivedAt: 5 }), row("c", "  ")], "m");
  expect(choices).toEqual([{ value: "m", label: "Dot" }, { value: "b", label: "Budget" }, { value: "c", label: "Untitled conversation" }]);
  expect(shownMain(choices, "m")).toBe("m");
});

it("FM: a Main that is gone, archived or unset shows \"No Main\", never a blank or an error", () => {
  const choices = mainChoices([row("b", "Budget"), row("m", "Dot", { archivedAt: 5 })], "m");
  expect(choices).toEqual([{ value: "b", label: "Budget" }]);
  expect(shownMain(choices, "m")).toBe("__no_main__");
  expect(shownMain(choices, null)).toBe("__no_main__");
  expect(shownMain([], "gone")).toBe("__no_main__");
});
