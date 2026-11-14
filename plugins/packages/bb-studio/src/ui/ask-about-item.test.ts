import { expect, it } from "vitest";
import { askLabel } from "../kit/app/item-header";
import { askBotNameOf } from "./ask-about-item";

it("names the Bot in Ask … about this, and says the Bot until its name is known", async () => {
  expect(askLabel("Scout")).toBe("Ask Scout about this");
  expect(askLabel(null)).toBe("Ask the Bot about this");
  const bots = [{ id: "bot_main", name: "Scout" }, { id: "bot_2", name: "Ledger" }];
  expect(await askBotNameOf(async () => ({ bots, currentBotId: "bot_2" }))).toBe("Ledger");
  expect(await askBotNameOf(async () => ({ bots, currentBotId: null }))).toBe("Scout");
  expect(await askBotNameOf(async () => { throw new Error("offline"); })).toBeNull();
});
