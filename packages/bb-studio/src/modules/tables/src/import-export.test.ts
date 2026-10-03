import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import type { Table } from "@bb-studio/kit/tables";
import plugin from "../server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });
function fixture() {
  const host = createFakePluginHost({ pluginId: "studio-tables" });
  hosts.push(host);
  plugin(host.bb);
  return host.harness.behavior;
}
async function create(rpc: ReturnType<typeof fixture>) {
  return (await rpc.callRpc("create", { title: "CSV boundary", projectId: null }) as { table: Table }).table;
}

it("imports BOM-prefixed quoted headers without changing column identity", async () => {
  const rpc = fixture();
  const table = await create(rpc);
  expect(await rpc.callRpc("importCsv", { id: table.id, csv: '\uFEFF"Name","Notes"\r\n"Ada","internal\uFEFFmarker"\r\n' })).toEqual({ imported: 1 });
  const { table: saved } = await rpc.callRpc("get", { id: table.id }) as { table: Table };
  expect(saved.columns.map((column) => column.name)).toEqual(["Name", "Notes"]);
  expect(saved.rows[0]!.values.name).toBe("Ada");
  expect(Object.values(saved.rows[0]!.values)).toContain("internal\uFEFFmarker");
});

it("round-trips CSV quotes, embedded CRLF, Unicode, formula text and empty cells through persisted handlers", async () => {
  const rpc = fixture();
  const table = await create(rpc);
  const source = '"Name","Notes","Empty"\r\n"Ada, \"\"A\"\"","line one\r\nline two",""\r\n"=SUM(1,2)","雪 🐈",""\r\n"+123","@literal",""\r\n';
  expect(await rpc.callRpc("importCsv", { id: table.id, csv: source })).toEqual({ imported: 3 });
  expect(await rpc.callRpc("exportCsv", { id: table.id })).toEqual({ csv: source });
  const copy = await create(rpc);
  await rpc.callRpc("importCsv", { id: copy.id, csv: source });
  expect(await rpc.callRpc("exportCsv", { id: copy.id })).toEqual({ csv: source });
});

it("rejects malformed CSV atomically and treats header-only/blank records as no additions", async () => {
  const rpc = fixture();
  const table = await create(rpc);
  await rpc.callRpc("importCsv", { id: table.id, csv: "Name\nKeep\n" });
  const before = await rpc.callRpc("get", { id: table.id });
  await expect(rpc.callRpc("importCsv", { id: table.id, csv: 'Name,New\nGood,ok\n"Unclosed' })).rejects.toThrow(/Unclosed quote/);
  expect(await rpc.callRpc("get", { id: table.id })).toEqual(before);
  for (const csv of ["", "Name\r\n", "Name,Notes\r\n,\r\n"]) {
    expect(await rpc.callRpc("importCsv", { id: table.id, csv })).toEqual({ imported: 0 });
  }
  expect(await rpc.callRpc("get", { id: table.id })).toEqual(before);
  await expect(rpc.callRpc("exportCsv", { id: "missing" })).rejects.toThrow(/not found/);
  await expect(rpc.callRpc("importCsv", { id: table.id, csv: "x".repeat(2_000_001) })).rejects.toThrow(/validation/);
  expect(await rpc.callRpc("get", { id: table.id })).toEqual(before);
});

it("imports and exports all 1207 rows, including the final row beyond query page limits", async () => {
  const rpc = fixture();
  const table = await create(rpc);
  const source = '"Name","Notes"\r\n' + Array.from({ length: 1207 }, (_, i) => `"Row ${i}","${i === 1206 ? "last, row" : "x"}"\r\n`).join("");
  expect(await rpc.callRpc("importCsv", { id: table.id, csv: source })).toEqual({ imported: 1207 });
  expect(await rpc.callRpc("exportCsv", { id: table.id })).toEqual({ csv: source });
  const page = await rpc.callRpc("query", { id: table.id, offset: 1200, limit: 100 });
  expect(page).toMatchObject({ total: 1207, nextOffset: null, rows: expect.arrayContaining([expect.objectContaining({ values: expect.objectContaining({ name: "Row 1206" }) })]) });
});
