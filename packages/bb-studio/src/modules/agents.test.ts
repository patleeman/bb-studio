import { expect, it, vi } from "vitest";
import type { BbPluginApi, PluginAgentConfigurationContext } from "@get-bb/plugin-sdk";
import { ModuleAgents } from "./agents";

it("registers once while retaining default tools and each module's conditional selection", () => {
  const configure = vi.fn(); const registerTool = vi.fn();
  const agents = new ModuleAgents({ configure, registerTool } as unknown as BbPluginApi["agents"]);
  const core = agents.scope(["studio"]), tables = agents.scope(["studio-tables"]), feed = agents.scope();
  for (const [scope, name] of [[core, "studio_list_items"], [tables, "tables_list"], [feed, "feed_post"], [feed, "feed_read"]] as const)
    scope.registerTool({ name } as never);
  let posting = false;
  feed.configure(() => ({ tools: posting ? ["feed_post", "feed_read"] : ["feed_read"], skills: [], instructions: posting ? "Post reports" : undefined }));
  agents.register();
  expect(configure).toHaveBeenCalledTimes(1);
  const resolve = configure.mock.calls[0]![0];
  const context = {} as PluginAgentConfigurationContext;
  expect(resolve(context)).toEqual({ tools: ["studio_list_items", "tables_list", "feed_read"], skills: ["studio", "studio-tables"], instructions: "" });
  posting = true;
  expect(resolve(context).tools).toContain("feed_post");
  expect(resolve(context).instructions).toBe("Post reports");
  expect(registerTool).toHaveBeenCalledTimes(4);
});
