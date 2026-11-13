import { expect, it } from "vitest";
import { StudioApprovals } from "./studio-approvals.js";

it("answers whether Studio's push reached a device, waiting for a push still on its way, and no when none comes", async () => {
  const approvals = new StudioApprovals(30);
  const waiting = approvals.reached("int_1", "apns:phone");
  approvals.finish("int_1", ["apns:phone"]);
  expect(await waiting).toBe(true);
  expect(await approvals.reached("int_1", "apns:ipad")).toBe(false);
  const started = Date.now();
  expect(await approvals.reached("int_none", "apns:phone")).toBe(false);
  expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  approvals.finish("int_2", []);
  expect(await approvals.reached("int_2", "apns:phone")).toBe(false);
});
