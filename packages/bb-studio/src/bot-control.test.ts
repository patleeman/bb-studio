import { expect, it } from "vitest";
import { botControlRefusal } from "./bot";
import { twoBots } from "./test/bot-fixture";

it("lets only a Bot's own chat pause or stop it; refuses runners, threads it started and other threads", async () => {
  const { bots } = await twoBots();
  const runnerBot = (id: string) => id === "thr_runner" ? "bot_scout" : null;
  const check = async (threadId: string, action: "pause" | "stop") => botControlRefusal(await bots.actingFor(threadId, runnerBot), action);
  expect(await check("thr_scout", "pause")).toBeNull();
  expect(await check("thr_main", "stop")).toBeNull();
  expect(await check("thr_child", "pause")).toMatch(/^Refused: A thread the Bot started can't pause its Bot\. .*Studio → Bot → Pause/);
  expect(await check("thr_runner", "stop")).toMatch(/^Refused: A runner can't stop its Bot\. .*\(runner_report\)/);
  expect(await check("thr_loose", "stop")).toMatch(/^Refused: This thread isn't a Bot's chat, so it can't stop the Bot\./);
  expect(botControlRefusal(null, "pause")).toContain("Studio → Bot → Pause");
});
