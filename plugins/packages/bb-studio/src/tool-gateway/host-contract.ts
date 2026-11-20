// The contract between Studio's server and its host worker (tool-gateway-host.ts),
// the separate process that runs stdio MCP servers. Ported from Agent Plugins'
// host-contract.ts, tools only.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { ExperimentalHostSignals } from "@get-bb/plugin-sdk/host";
import { z } from "zod";

const jsonRecordSchema = z.record(z.string(), z.unknown());
const serverKeySchema = z.string().min(1).max(512);
const catalogSchema = z.object({ tools: z.array(jsonRecordSchema) }).strict();

export const toolGatewayHostContract = defineRpcContract({
  start: {
    input: z.object({
      key: serverKeySchema,
      command: z.string().min(1).max(16_384),
      args: z.array(z.string().max(16_384)).max(256),
      cwd: z.string().min(1).max(16_384),
      env: z.record(z.string(), z.string().max(16_384)),
    }).strict(),
    output: catalogSchema,
  },
  refresh: { input: z.object({ key: serverKeySchema }).strict(), output: catalogSchema },
  close: { input: z.object({ key: serverKeySchema }).strict(), output: z.object({ closed: z.boolean() }).strict() },
  callTool: {
    input: z.object({
      key: serverKeySchema,
      name: z.string().min(1).max(512),
      args: jsonRecordSchema,
      toolDefinition: jsonRecordSchema.optional(),
      timeoutMs: z.number().int().min(1000).max(600_000),
    }).strict(),
    output: jsonRecordSchema,
  },
  /** Each running server's process id and resident memory, for the settings page. */
  stats: { input: z.object({}).strict(), output: z.object({ servers: z.array(z.object({ key: z.string(), pid: z.number().nullable(), rssBytes: z.number().nullable() })) }).strict() },
});

export const toolGatewayHostSignals = {
  catalogChanged: { payload: z.object({ key: serverKeySchema, error: z.string().nullable() }).strict() },
  connectionChanged: { payload: z.object({ key: serverKeySchema, status: z.enum(["closed", "error"]), error: z.string().nullable() }).strict() },
  /** One stderr line from a server, at most 2000 characters. The server redacts secrets before logging it. */
  stderr: { payload: z.object({ key: serverKeySchema, line: z.string().max(2000) }).strict() },
} satisfies ExperimentalHostSignals;

export type HostCatalog = { tools: Array<Record<string, unknown>> };
