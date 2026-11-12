import { expect, it } from "vitest";
import { areaChips, eventLabel, ownerName, ownerThread, triggerLabel } from "./model";

const NOW = new Date("2026-10-31T22:26:00").getTime();
const names = { bot: "Chief of Staff", leads: new Map([["thr_lead", "Larkspur lead"]]) };

it("says what a held todo waits for instead of Anytime", () => {
  expect(triggerLabel({ type: "none" }, NOW).text).toBe("Anytime");
  expect(triggerLabel({ type: "none" }, NOW, "budget")).toEqual({ text: "Next free slot", icon: "TimeSchedule" });
  expect(triggerLabel({ type: "none" }, NOW, "morning")).toEqual({ text: "Tomorrow morning card", icon: "Calendar" });
  // A due time trigger held by the budget doesn't show its past time.
  expect(triggerLabel({ type: "time", at: NOW - 60_000 }, NOW, "budget").text).toBe("Next free slot");
  expect(triggerLabel({ type: "time", at: new Date("2026-11-02T10:00:00").getTime() }, NOW).text).toBe("Mon 10:00 AM");
});

it("reads an event trigger by its label, a reply, or the key prettified", () => {
  expect(eventLabel("unraid:php-cve-2026-115560-fixed", "when Unraid fixes the PHP CVE")).toBe("When Unraid fixes the PHP CVE");
  expect(eventLabel("reply:sam")).toBe("When Sam replies");
  expect(eventLabel("unraid:php-cve-2026-115560-fixed")).toBe("Unraid: php cve 2026 115560 fixed");
  expect(eventLabel("desktop:online")).toBe("Desktop: online");
  expect(triggerLabel({ type: "event", event: "unraid:php-cve-2026-115560-fixed", label: "when Unraid fixes the PHP CVE" }, NOW)).toEqual({ text: "When Unraid fixes the PHP CVE", icon: "Zap" });
});

it("names an owner: the Bot, a lead, the thread's title, or An agent", () => {
  expect(ownerName("patrick", names)).toBe("You");
  expect(ownerName("cos", names)).toBe("Chief of Staff");
  expect(ownerName("thread:thr_lead", names)).toBe("Larkspur lead");
  expect(ownerName("thread:thr_demo000014", names, { owner: "thread:thr_demo000014", name: "AI power Long read", threadId: "thr_demo000014" })).toBe("AI power Long read");
  expect(ownerName("thread:thr_demo000014", names)).toBe("An agent");
});

it("links the Bot's chat for the CoS, a thread while it exists, and nothing once it's gone", () => {
  expect(ownerThread("cos", "thr_bot")).toBe("thr_bot");
  expect(ownerThread("cos", null)).toBeNull();
  expect(ownerThread("patrick", "thr_bot")).toBeNull();
  expect(ownerThread("thread:thr_x", "thr_bot")).toBe("thr_x");
  expect(ownerThread("thread:thr_x", "thr_bot", { owner: "thread:thr_x", name: "Old (archived)", threadId: "thr_x" })).toBe("thr_x");
  expect(ownerThread("thread:thr_x", "thr_bot", { owner: "thread:thr_x", name: "A thread that was removed", threadId: null })).toBeNull();
});

it("builds area chips from data only, keeping a chosen area with no loops left", () => {
  expect(areaChips(["Alpha", "Beta"], null)).toEqual([null, "Alpha", "Beta"]);
  expect(areaChips(undefined, null)).toEqual([null]);
  expect(areaChips(["Alpha"], "Beta")).toEqual([null, "Alpha", "Beta"]);
});
