import { expect, it } from "vitest";
import { z } from "zod";
import { readAvailable } from "./read-available";

it("distinguishes confirmed absence from failed reads, including invalid payloads", async () => {
  expect(await readAvailable(async () => [])).toEqual({ status: "ok", value: [] });
  for (const error of [{ status: 404 }, { code: "NOT_FOUND" }]) {
    expect(await readAvailable(async () => { throw error; })).toEqual({ status: "absent" });
  }
  for (const error of [{ status: 503 }, new Error("upstream not found in cache"), new Error("offline")]) {
    expect(await readAvailable(async () => { throw error; })).toEqual({ status: "unavailable", error });
  }
  expect(await readAvailable(async () => z.array(z.string()).parse([1]))).toMatchObject({ status: "unavailable" });
});
