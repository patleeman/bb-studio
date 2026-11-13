import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import plugin from "../server";
import { TOOL_LABELS, withToolLabel } from "./tool-labels";

type Registered = { name: string; presentation?: { label?: { pending: string; completed: string } } };

it("gives every Studio tool a plain label for its row in the chat, never its tool name", async () => {
  const host = createFakePluginHost({ pluginId: "studio", sdk: { threads: { list: async () => [], get: async () => null }, projects: { list: async () => [] } } } as never);
  await plugin(host.bb);
  const registered = (host.harness.registrations as unknown as { agentTools: Map<string, Registered> | Registered[] }).agentTools;
  const tools = [...(registered instanceof Map ? registered.values() : registered)];
  expect(tools.length).toBeGreaterThan(100);
  const unlabeled = tools.filter((tool) => !tool.presentation?.label).map((tool) => tool.name);
  expect(unlabeled).toEqual([]);
  for (const tool of tools) {
    const { pending, completed } = tool.presentation!.label!;
    for (const label of [pending, completed]) {
      expect(label.length).toBeLessThanOrEqual(80);
      expect(label).not.toMatch(/_/);
      expect(label).not.toContain(tool.name);
    }
  }
  const label = (name: string) => tools.find((tool) => tool.name === name)!.presentation!.label;
  expect(label("conversation_continue_new")).toEqual({ pending: "Continuing in a new conversation", completed: "Continued in a new conversation" });
  expect(label("bot_profile_update")).toEqual({ pending: "Updating the Bot's profile", completed: "Updated the Bot's profile" });
  expect(label("design_create")).toEqual({ pending: "Creating a design", completed: "Created a design" });
  await host.harness.lifecycle.dispose();
});

it("keeps a tool's own label and its other presentation fields", () => {
  const own = { name: "pages_read", presentation: { label: { pending: "Opening", completed: "Opened" } } };
  expect(withToolLabel(own)).toBe(own);
  expect(withToolLabel({ name: "pages_read", presentation: { suppress: true } })).toEqual({ name: "pages_read", presentation: { suppress: true, label: { pending: TOOL_LABELS.pages_read![0], completed: TOOL_LABELS.pages_read![1] } } });
  expect(withToolLabel({ name: "unknown_tool" })).toEqual({ name: "unknown_tool" });
});
