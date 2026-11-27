import { expect, it } from "vitest";
import { dueLabel, eventLabel, fullWhen, ownerName, ownerThread, shortWhen, triggerLabel } from "./model";
import { zonedTime } from "../clock";

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

it("reads times in Todos' time zone when one is set: a 9:00 AM Pacific call is 9:00 AM in Pacific and 12:00 PM in Eastern", () => {
  const now = zonedTime(2026, 11, 13, 18, 0, "America/New_York");
  const due = zonedTime(2026, 11, 16, 9, 0, "America/Los_Angeles");
  expect(dueLabel(due, now, "America/Los_Angeles")).toEqual({ text: "Due Mon, 9:00 AM", urgent: false });
  expect(dueLabel(due, now, "America/New_York")).toEqual({ text: "Due Mon, 12:00 PM", urgent: false });
  expect(fullWhen(due, now, "America/Los_Angeles")).toBe("Mon 9:00 AM");
  expect(shortWhen(due, due - 3_600_000, "America/Los_Angeles")).toBe("9:00 AM");
  expect(triggerLabel({ type: "time", at: due }, now, null, "America/Los_Angeles").text).toBe("Mon 9:00 AM");
});

it("finds today, tomorrow and the week by the zone's calendar, not the computer's", () => {
  const now = zonedTime(2026, 11, 13, 22, 30, "America/Los_Angeles");
  const soon = zonedTime(2026, 11, 13, 23, 30, "America/Los_Angeles");
  expect(dueLabel(soon, now, "America/Los_Angeles")?.text).toBe("Due today, 11:30 PM");
  expect(dueLabel(soon, now, "America/New_York")?.text).toBe("Due today, 2:30 AM");
  expect(dueLabel(soon, now, "Europe/London")?.text).toBe("Due today, 7:30 AM");
});

