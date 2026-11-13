import { describe, expect, it } from "vitest";
import type { RuntimePermissionPolicy } from "@get-bb/plugin-sdk/provider-bridge";
import { buildClaudeSessionParams } from "./session-params.js";

const FULL_POLICY = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} satisfies RuntimePermissionPolicy;

describe("plugin tool labels reach the Claude Code session", () => {
  it("keeps each dynamic tool's presentation", () => {
    const presentation = {
      label: { pending: "Listing designs", completed: "Listed designs" },
      icon: { glyph: "studio/design" },
    };
    const params = buildClaudeSessionParams({
      threadId: "thread-1",
      cwd: "/tmp/worktree",
      instructionMode: "append",
      dynamicTools: [
        {
          name: "design_list",
          description: "List designs",
          inputSchema: { type: "object" },
          presentation,
        },
        { name: "plain", description: "No label", inputSchema: {} },
      ],
      options: FULL_POLICY,
    });
    expect(params.dynamicTools).toEqual([
      {
        name: "design_list",
        description: "List designs",
        inputSchema: { type: "object" },
        presentation,
      },
      { name: "plain", description: "No label", inputSchema: {} },
    ]);
  });
});
