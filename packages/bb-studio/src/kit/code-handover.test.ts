import { expect, test, vi } from "vitest";
import { codeProcesses, processRows, quiesceCode } from "./code-handover";

test("finds only the old root's servers and descendants, not Studio's", () => {
  const rows = processRows("10 1 node /old/watchdog.cjs\n11 10 node server\n12 11 terminal\n20 1 node /studio/code/watchdog.cjs\n21 20 extension-host");
  expect(codeProcesses(rows, "/old")).toEqual([10, 11, 12]);
});
test("waits for orphaned descendants before allowing the copy", async () => {
  const states = [processRows("10 1 node /old/watchdog.cjs\n11 10 editor"), processRows("11 1 editor"), []];
  const stop = vi.fn(), pause = vi.fn(async () => {});
  await quiesceCode("/old", { list: async () => states.shift()!, stop, pause });
  expect(stop.mock.calls).toEqual([[10], [11]]);
  expect(pause).toHaveBeenCalledTimes(2);
});
test("fails closed when a server cannot be stopped or enumerated", async () => {
  await expect(quiesceCode("/old", { list: async () => processRows("10 1 node /old/watchdog.cjs"), stop: () => {}, pause: async () => {} }, 2)).rejects.toThrow("remain blocked");
  await expect(quiesceCode("/old", { list: async () => { throw new Error("ps failed"); }, stop: () => {}, pause: async () => {} })).rejects.toThrow("ps failed");
});
