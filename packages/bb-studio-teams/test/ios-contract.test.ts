import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { z } from "zod";
import { rpcContract } from "../contract";

const iosMethods = [
  "list", "room", "send", "updateRoom", "createRoom", "deleteRoom", "member",
  "channelState", "stopRoom", "retryRouting", "automationList", "automationCreate",
  "automationUpdate", "automationAction", "automationRuns", "attentionList",
  "attentionUpdate", "get", "document", "saveDocument",
] as const;

function iosContractShape() {
  return Object.fromEntries(iosMethods.map((name) => {
    const method = rpcContract[name];
    return [name, {
      input: z.toJSONSchema(method.input, { unrepresentable: "any" }),
      output: z.toJSONSchema(method.output, { unrepresentable: "any" }),
    }];
  }));
}

test("iOS RPC input and output shapes remain compatible", () => {
  const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("./ios-contract.json", import.meta.url)), "utf8"));
  expect(iosContractShape()).toEqual(fixture);
  const room = rpcContract.room.output.shape;
  expect(Object.keys(room)).toEqual(expect.arrayContaining(["messages", "hasOlder", "approvals", "room", "runs", "jobs"]));
  expect(Object.keys(room.runs.element.shape)).toEqual(expect.arrayContaining(["id", "status", "routing", "routingError"]));
  expect(Object.keys(room.jobs.element.shape)).toEqual(expect.arrayContaining(["id", "botId", "status", "activitySnippet"]));
});
