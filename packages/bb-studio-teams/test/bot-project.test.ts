import test from "node:test";
import assert from "node:assert/strict";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { personalProjectId } from "../bot-project";

const withProjects = (list: () => Promise<unknown[]>) =>
  ({ sdk: { projects: { list } } }) as unknown as BbPluginApi;

test("bots and channel threads use BB's Personal project, never a new one", async () => {
  assert.equal(
    await personalProjectId(withProjects(async () => [
      { id: "proj_other", kind: "standard" },
      { id: "proj_personal", kind: "personal" },
    ])),
    "proj_personal",
  );
  await assert.rejects(personalProjectId(withProjects(async () => [])), /Personal project is unavailable/);
  await assert.rejects(personalProjectId(withProjects(async () => { throw new Error("offline"); })), /offline/);
});
