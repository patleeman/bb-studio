import { expect, it } from "vitest";
import { contractParts, rpcContract } from "./public-contract";

it("publishes every part's methods, with no name in two parts", () => {
  const owners = new Map<string, string[]>();
  for (const [part, contract] of Object.entries(contractParts)) for (const method of Object.keys(contract)) owners.set(method, [...(owners.get(method) ?? []), part]);
  expect([...owners].filter(([, parts]) => parts.length > 1)).toEqual([]);
  expect(Object.keys(rpcContract).sort()).toEqual([...owners.keys()].sort());
});

it("includes Memory and links.resolve", () => {
  expect(Object.keys(rpcContract)).toEqual(expect.arrayContaining(["memory.overview", "memory.list", "memory.get", "memory.add", "memory.update", "memory.archive", "memory.profile", "links.resolve"]));
});
