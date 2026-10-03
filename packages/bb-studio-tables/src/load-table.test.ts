import type { Table } from "@bb-studio/kit/tables";
import { expect, it, vi } from "vitest";
import { loadTable, type TableLoad } from "./load-table";

const table = { id: "tbl_recovered", title: "Recovered" } as Table;

it("clears a transient error when the next request succeeds", async () => {
  let state: TableLoad = { table: null, error: "" };
  const receive = (next: TableLoad) => { state = next; };
  loadTable(() => Promise.reject(new Error("offline")), receive);
  await Promise.resolve();
  expect(state.error).toBe("offline");
  loadTable(() => Promise.resolve({ table }), receive);
  await Promise.resolve();
  expect(state).toEqual({ table, error: "" });
});

it.each(["success", "error"])("ignores an older %s after a newer refresh succeeds", async (outcome) => {
  let resolve!: (value: { table: Table | null }) => void;
  let reject!: (error: Error) => void;
  const old = new Promise<{ table: Table | null }>((yes, no) => { resolve = yes; reject = no; });
  const receive = vi.fn();
  const cancel = loadTable(() => old, receive);
  cancel();
  loadTable(() => Promise.resolve({ table }), receive);
  await Promise.resolve();
  if (outcome === "success") resolve({ table: null });
  else reject(new Error("old error"));
  await Promise.resolve();
  expect(receive.mock.calls).toEqual([[{ table, error: "" }]]);
});
