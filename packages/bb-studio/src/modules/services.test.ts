import { expect, it, vi } from "vitest";
import { z } from "zod";
import { ModuleServices } from "./services";

const contract = { read: { input: z.object({ id: z.string() }), output: z.object({ title: z.string() }) } };
it("calls a module in process and rejects invalid inputs before invoking it", async () => {
  const services = new ModuleServices();
  const read = vi.fn(({ id }: { id: string }) => ({ title: id }));
  services.register("tables", contract, { read });
  expect(await services.client("tables", contract).call("read", { id: "sample" })).toEqual({ title: "sample" });
  await expect(services.call("tables", "read", { id: 1 })).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1);
  expect(services.has("tables")).toBe(true);
});
it("rejects duplicate services, absent methods and invalid handler output", async () => {
  const services = new ModuleServices();
  services.register("tables", contract, { read: () => ({ title: 12 as unknown as string }) });
  expect(() => services.register("tables", contract, { read: () => ({ title: "x" }) })).toThrow("already registered");
  await expect(services.call("tables", "missing", null)).rejects.toThrow("Unknown module service");
  await expect(services.call("missing", "read", null)).rejects.toThrow("Unknown module service");
  await expect(services.call("tables", "read", { id: "sample" })).rejects.toThrow();
});
