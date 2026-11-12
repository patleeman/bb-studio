import { EventEmitter } from "node:events";
import { connect } from "node:http2";
import { afterEach, expect, it, vi } from "vitest";
import { Http2ApnsSender } from "./apns.js";

vi.mock("node:http2", () => ({ connect: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("closes GOAWAY sessions gracefully and retains them for disposal until closed", async () => {
  const first = Object.assign(new EventEmitter(), { closed: false, destroyed: false, close: vi.fn() });
  const second = Object.assign(new EventEmitter(), { closed: false, destroyed: false, close: vi.fn() });
  vi.mocked(connect).mockReturnValueOnce(first as any).mockReturnValueOnce(second as any);
  const sender = new Http2ApnsSender();
  // Open without sending a stream; this test covers connection ownership.
  (sender as any).session("production");
  first.emit("goaway");
  expect(first.close).toHaveBeenCalledTimes(1);
  expect((sender as any).session("production")).toBe(second);
  sender.close();
  expect(first.close).toHaveBeenCalledTimes(2);
  expect(second.close).toHaveBeenCalledTimes(1);
});
