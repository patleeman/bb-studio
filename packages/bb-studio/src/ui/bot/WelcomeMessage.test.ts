import { expect, it } from "vitest";
import { welcomeStep } from "./WelcomeMessage";

const bot = { id: "bot_main" };

it("keeps watching while onboarding is pending, and opens a new Main once when it replaces the one opened", () => {
  expect(welcomeStep({ threadId: "thr_1", opened: false, pending: true, bot }, null)).toEqual({ done: false, open: "thr_1" });
  expect(welcomeStep({ threadId: "thr_1", opened: false, pending: true, bot }, "thr_1")).toEqual({ done: false, open: null });
  expect(welcomeStep({ threadId: "thr_1", opened: true, pending: true, bot }, "thr_1")).toEqual({ done: false, open: null });
  expect(welcomeStep({ threadId: "thr_2", opened: false, pending: false, bot }, "thr_1")).toEqual({ done: true, open: "thr_2" });
  expect(welcomeStep({ threadId: null, opened: true, pending: false, bot: null }, null)).toEqual({ done: true, open: null });
});
