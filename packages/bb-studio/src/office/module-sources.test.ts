import { z } from "zod";
import { expect, it } from "vitest";
import { ModuleServices } from "../modules/services";
import { moduleInboxSources } from "./module-sources";

it("activates after module registration and groups report updates by story", async () => {
  const services = new ModuleServices(); const [feed] = moduleInboxSources(services);
  expect(await feed!.list()).toEqual([]);
  let calls = 0;
  services.register("feed", { list: { input: z.unknown(), output: z.unknown() } }, { list: input => {
    calls++;
    const older = !!(input as { cursor?: string }).cursor;
    return { posts: [{ id: older ? "p1" : "p2", story: "launch", projectId: "work", title: "Launch", body: older ? "Old" : "New", botId: "bot", threadId: "thread", updatedAt: older ? 1 : 2, resolvedAt: null, priority: older ? "normal" : "urgent" }], nextCursor: older ? null : "next" };
  } });
  expect(await feed!.list()).toMatchObject([{ key: "feed:story:launch", body: "New", createdAt: 2, urgent: true, projectId: "work" }]);
  expect(calls).toBe(2);
});

it("accepts task reviews through the task service and scopes bot requests to requester projects", async () => {
  const services = new ModuleServices(); let update: unknown;
  const schema = { input: z.unknown(), output: z.unknown() };
  services.register("studio-tasks", { board: schema, update: schema }, {
    board: () => ({ tasks: [{ id: "task", title: "Review", description: "", status: "custom-review", statusLabel: "Review", projectId: "work", assignee: "bot:bot", archived: false, updatedAt: 10, recurrence: null, handoff: { threadId: "thread", state: "idle", note: "Finished" } }] }),
    update: input => { update = input; return {}; },
  });
  services.register("bot-teams", { list: schema, resolveBotCreateRequest: schema }, {
    list: () => ({ bots: [{ id: "bot", projectId: "work" }], botCreateRequests: [{ id: "request", requesterBotId: "bot", name: "Helper", description: "Review work", mission: "", createdAt: 2, expiresAt: Date.now() + 10000 }] }),
    resolveBotCreateRequest: () => ({}),
  });
  const [,tasks,bots] = moduleInboxSources(services);
  const [review] = await tasks!.list();
  expect(review).toMatchObject({ projectId: "work", threadId: "thread", botId: "bot", body: "Finished" });
  await tasks!.act(review!, "accept");
  expect(update).toEqual({ id: "task", status: "done" });
  expect(await bots!.list()).toMatchObject([{ key: "bot-create:request", projectId: "work" }]);
});
