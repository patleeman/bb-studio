import type {
  AcpClassifiedToolCall,
  AcpDialect,
  AcpToolCallUpdateEvent,
} from "@get-bb/plugin-sdk/provider-bridge/acp";
import { z } from "zod";
import { readAntigravityCredentials } from "./auth.js";
import { ANTIGRAVITY_DIALECT_ID } from "./declaration.js";
import { agyInstallerCommand } from "./maintenance.js";
import { readAntigravityUsage } from "./usage.js";

const subagentInputSchema = z
  .object({
    Role: z.string().optional(),
    Prompt: z.string().optional(),
    TypeName: z.string().optional(),
  })
  .passthrough();

function classifyAntigravityToolCall(
  event: AcpToolCallUpdateEvent,
): AcpClassifiedToolCall | undefined {
  const title = event.title?.toLowerCase() ?? "";
  if (!title.includes("invoke_subagent") && !title.includes("subagent")) {
    return undefined;
  }
  const parsed = subagentInputSchema.safeParse(event.rawInput);
  if (!parsed.success || (!parsed.data.Role && !parsed.data.Prompt)) {
    return undefined;
  }
  const label =
    parsed.data.Role ?? parsed.data.Prompt ?? event.title ?? "Subagent";
  return {
    item: {
      type: "delegation",
      childRef: event.toolCallId,
      label,
      background: true,
    },
    presentation: {
      icon: { glyph: "Bot" },
      label: { pending: "Running subagent", completed: "Subagent" },
      title: label,
      ...(parsed.data.TypeName ? { detail: parsed.data.TypeName } : {}),
    },
  };
}

export const ANTIGRAVITY_ACP_DIALECT: AcpDialect = {
  id: ANTIGRAVITY_DIALECT_ID,
  classifyToolCall: classifyAntigravityToolCall,
  maintenance: {
    loginCommand: "agy acp --login",
    installer: agyInstallerCommand,
    readAccount: async () => {
      const credentials = await readAntigravityCredentials();
      return credentials === null ? null : { email: credentials.email };
    },
    readUsage: readAntigravityUsage,
  },
};
