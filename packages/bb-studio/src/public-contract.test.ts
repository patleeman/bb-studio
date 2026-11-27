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

it("includes the task and work card reads for the phone", () => {
  expect(Object.keys(rpcContract)).toEqual(expect.arrayContaining(["tasks.get", "tasks.getMany", "tasks.list", "work.get", "work.list", "work.dismiss", "work.clear", "loops.get", "loops.scheduled"]));
});

it("no longer publishes the removed loops, tasks and strands RPCs", () => {
  const gone = ["strands.overview", "loops.list", "loops.add", "loops.update", "loops.act", "loops.fire", "loops.place", "loops.places", "loops.setPlaces", "loops.morning", "tasks.act", "tasks.board", "tasks.flight", "tasks.inFlight"];
  for (const method of gone) expect(Object.keys(rpcContract)).not.toContain(method);
});

it("includes the strands the phone reads", () => {
  expect(Object.keys(rpcContract)).toEqual(expect.arrayContaining(["strands.list", "strands.tags", "strands.opened"]));
});

it("includes the router's notice and Hand off for the phone", () => {
  expect(Object.keys(rpcContract)).toEqual(expect.arrayContaining(["router.notice.get", "router.notice.dismiss", "router.handoff", "toolGateway.overview"]));
});
