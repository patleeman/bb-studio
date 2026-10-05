import { expect, test } from "vitest";
import { draftRecipients } from "./draft-recipients";

const threads = [
  { id: "thr_lead", title: "Project Lead", parentThreadId: null, status: "idle", updatedAt: 1, error: null, alias: "a" },
  { id: "thr_cmd", title: "Command mode", parentThreadId: null, status: "active", updatedAt: 1, error: null, alias: "b" },
];
const draft = (text: string, mentions: { provider: string; id: string; label: string }[] = []) => ({ text, mentions: mentions.map(m => ({ from: 0, to: 0, ...m })) });

test("a draft addresses the threads it mentions, by pill or typed alias", () => {
  expect(draftRecipients(null, threads)).toEqual([]);
  expect(draftRecipients(draft("hello"), threads)).toEqual([]);
  expect(draftRecipients(draft("Command mode fix it", [{ provider: "studio", id: "space-threads:thr_cmd", label: "Command mode" }]), threads)).toEqual(["thr_cmd"]);
  expect(draftRecipients(draft("x", [{ provider: "thread", id: "thr_lead", label: "Project Lead" }]), threads)).toEqual(["thr_lead"]);
  expect(draftRecipients(draft("@b and @a please"), threads)).toEqual(["thr_cmd", "thr_lead"]);
  expect(draftRecipients(draft("@z nobody"), threads)).toEqual([]);
});
test("@all addresses everyone", () => {
  expect(draftRecipients(draft("@all stop"), threads)).toBe("everyone");
  expect(draftRecipients(draft("x", [{ provider: "studio", id: "broadcasts:all", label: "@all" }]), threads)).toBe("everyone");
});
