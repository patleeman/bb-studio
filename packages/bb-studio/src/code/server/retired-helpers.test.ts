import { expect, it } from "vitest";
import * as runtime from "./runtime";
import * as settings from "./settings";
import * as activity from "./activity";

it("exposes only the live process, layout and activity paths", () => {
  expect(runtime).not.toHaveProperty("leftoverPids");
  expect(settings).not.toHaveProperty("applyLayoutEverywhere");
  expect(activity).not.toHaveProperty("activityFrom");
});
