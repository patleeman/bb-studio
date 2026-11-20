// Tool Gateway's RPC contract: the MCP servers the user adds and approves,
// the requests agents make, and the per-provider access. Reads are open to
// every caller (the app, the phone, the CLI, agents); every change is
// refused unless the call comes from BB Studio's own app window on this Mac
// (server/caller.ts).
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// The frontend imports the contract, and a plugin frontend bundle can't
// resolve the root SDK. The SDK helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

export const TOOL_GATEWAY_TOOLS = ["tool_gateway_search", "tool_gateway_describe", "tool_gateway_call"] as const;
export const TOOL_GATEWAY_PREFIX = "tool_gateway_";

export const SERVER_KINDS = ["stdio", "streamable-http", "sse"] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];

/** A server id: lowercase letters, digits, `-` and `_`. Kept from Agent Plugins on import (`beeper`, `memex`). */
export const serverIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u, "Use lowercase letters, digits, - and _ (up to 64).");
export const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u, "An environment variable name is letters, digits and _.");
export const headerNameSchema = z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/u, "Not a valid header name.");

export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
export const MAX_CALL_TIMEOUT_MS = 10 * 60_000;

/**
 * A server as the app window adds or edits it. A secret value of `null`
 * keeps the value already stored for that name; a name left out is removed.
 */
export const serverInputSchema = z.object({
  id: serverIdSchema,
  label: z.string().trim().min(1).max(120),
  kind: z.enum(SERVER_KINDS),
  command: z.string().trim().max(4096).optional(),
  args: z.array(z.string().max(16_384)).max(256).optional(),
  cwd: z.string().trim().max(4096).nullable().optional(),
  url: z.string().trim().max(4096).optional(),
  env: z.record(envNameSchema, z.string().max(16_384).nullable()).optional(),
  headers: z.record(headerNameSchema, z.string().max(16_384).nullable()).optional(),
  callTimeoutMs: z.number().int().min(1000).max(MAX_CALL_TIMEOUT_MS).optional(),
}).strict();
export type ServerInput = z.infer<typeof serverInputSchema>;

/** What an agent, the CLI or another plugin may ask for. Names only: never a secret value. */
export const requestInputSchema = z.object({
  name: serverIdSchema,
  label: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(SERVER_KINDS).optional(),
  command: z.string().trim().max(4096).optional(),
  args: z.array(z.string().max(4096)).max(64).optional(),
  url: z.string().trim().max(4096).optional(),
  envNames: z.array(envNameSchema).max(64).optional(),
  headerNames: z.array(headerNameSchema).max(64).optional(),
  why: z.string().trim().min(1).max(1000),
}).strict();
export type RequestInput = z.infer<typeof requestInputSchema>;

export const SERVER_STATUSES = ["needs-approval", "stopped", "starting", "running", "needs-sign-in", "error", "off"] as const;
export type ServerStatus = (typeof SERVER_STATUSES)[number];

export const serverViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(SERVER_KINDS),
  command: z.string().nullable(),
  args: z.array(z.string()),
  cwd: z.string().nullable(),
  url: z.string().nullable(),
  envNames: z.array(z.string()),
  headerNames: z.array(z.string()),
  enabled: z.boolean(),
  approved: z.boolean(),
  status: z.enum(SERVER_STATUSES),
  lastError: z.string().nullable(),
  tools: z.number().int(),
  disabledTools: z.array(z.string()),
  projects: z.array(z.string()).nullable(),
  toolsChanged: z.boolean(),
  signIn: z.enum(["none", "signed-out", "signing-in", "signed-in"]),
  memoryBytes: z.number().nullable(),
  callTimeoutMs: z.number().int(),
  source: z.enum(["added", "request", "import"]),
  createdAt: z.number(),
  approvedAt: z.number().nullable(),
});
export type ServerView = z.infer<typeof serverViewSchema>;

export const requestViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  kind: z.enum(SERVER_KINDS),
  command: z.string().nullable(),
  args: z.array(z.string()),
  url: z.string().nullable(),
  envNames: z.array(z.string()),
  headerNames: z.array(z.string()),
  why: z.string(),
  threadId: z.string().nullable(),
  state: z.enum(["pending", "approved", "declined"]),
  taskId: z.string().nullable(),
  createdAt: z.number(),
});
export type RequestView = z.infer<typeof requestViewSchema>;

/** Which servers a provider's agents get: every approved one, or the ones picked. */
export const providerAccessSchema = z.object({
  access: z.boolean(),
  servers: z.union([z.literal("all"), z.array(serverIdSchema).max(500)]),
});
export type ProviderAccess = z.infer<typeof providerAccessSchema>;

export const providerViewSchema = providerAccessSchema.extend({
  id: z.string(),
  name: z.string(),
  acp: z.boolean(),
});
export type ProviderView = z.infer<typeof providerViewSchema>;

export const toolViewSchema = z.object({
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  inputSchema: z.record(z.string(), z.unknown()),
  added: z.boolean(),
});
export const logLineSchema = z.object({ at: z.number(), kind: z.string(), text: z.string() });

export const importCandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(SERVER_KINDS),
  command: z.string().nullable(),
  args: z.array(z.string()),
  url: z.string().nullable(),
  envNames: z.array(z.string()),
  headerNames: z.array(z.string()),
  wasApproved: z.boolean(),
  wasEnabled: z.boolean(),
  oauth: z.boolean(),
  needsNewCommand: z.string().nullable(),
  exists: z.boolean(),
});
export type ImportCandidate = z.infer<typeof importCandidateSchema>;
export const importPreviewSchema = z.object({
  source: z.enum(["studio", "bb"]).nullable(),
  servers: z.array(importCandidateSchema),
  skills: z.array(z.string()),
  oldPluginInstalled: z.boolean(),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const snapshotSchema = z.object({
  servers: z.array(serverViewSchema),
  requests: z.array(requestViewSchema),
  providers: z.array(providerViewSchema),
  ready: z.number().int(),
  importable: z.number().int(),
});
export type ToolGatewaySnapshot = z.infer<typeof snapshotSchema>;

const idInput = z.object({ id: serverIdSchema });
const ok = z.object({ ok: z.literal(true) });

export const toolGatewayContract = defineRpcContract({
  "toolGateway.snapshot": { input: z.null(), output: snapshotSchema },
  "toolGateway.server": {
    input: idInput,
    output: z.object({ server: serverViewSchema, tools: z.array(toolViewSchema), removedTools: z.array(z.string()), log: z.array(logLineSchema) }),
  },
  "toolGateway.providers": { input: z.null(), output: z.object({ providers: z.array(providerViewSchema) }) },
  /** Whether this call came from BB Studio's app window: the page shows changes only then. */
  "toolGateway.whoami": { input: z.null(), output: z.object({ appWindow: z.boolean() }) },
  /** Anyone may ask; a request is never a grant. */
  "toolGateway.request": { input: requestInputSchema, output: requestViewSchema },
  "toolGateway.importPreview": { input: z.null(), output: importPreviewSchema },
  // Gated: the app window only.
  "toolGateway.addServer": { input: z.object({ server: serverInputSchema, requestId: z.string().max(200).optional() }), output: serverViewSchema },
  "toolGateway.editServer": { input: z.object({ server: serverInputSchema }), output: serverViewSchema },
  "toolGateway.approve": { input: idInput, output: serverViewSchema },
  "toolGateway.decline": { input: z.object({ requestId: z.string().min(1).max(200) }), output: ok },
  "toolGateway.setEnabled": { input: idInput.extend({ enabled: z.boolean() }), output: serverViewSchema },
  "toolGateway.setToolEnabled": { input: idInput.extend({ tool: z.string().min(1).max(512), enabled: z.boolean() }), output: serverViewSchema },
  "toolGateway.setScope": { input: idInput.extend({ projects: z.array(z.string().min(1).max(200)).max(500).nullable() }), output: serverViewSchema },
  "toolGateway.remove": { input: idInput, output: ok },
  "toolGateway.signIn": { input: idInput, output: z.object({ url: z.string().nullable() }) },
  "toolGateway.finishSignIn": { input: idInput.extend({ callbackUrl: z.string().min(1).max(8192) }), output: serverViewSchema },
  "toolGateway.signOut": { input: idInput, output: serverViewSchema },
  "toolGateway.testTool": {
    input: idInput.extend({ tool: z.string().min(1).max(512), args: z.record(z.string(), z.unknown()) }),
    output: z.object({ ok: z.boolean(), result: z.unknown(), error: z.string().nullable(), ms: z.number() }),
  },
  "toolGateway.setProvider": { input: providerAccessSchema.extend({ providerId: z.string().min(1).max(200) }), output: z.object({ providers: z.array(providerViewSchema) }) },
  "toolGateway.import": {
    input: z.object({ ids: z.array(serverIdSchema).min(1).max(200) }),
    output: z.object({ imported: z.array(z.string()), skipped: z.array(z.object({ id: z.string(), reason: z.string() })) }),
  },
  /** After an import: removes the Agent Plugins plugin, so agents don't get both gateways. */
  "toolGateway.removeOldPlugin": { input: z.null(), output: ok },
});

/** The phone's view: servers, status and pending requests. Read-only. */
export const toolGatewayOverviewSchema = z.object({
  servers: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(SERVER_KINDS), status: z.enum(SERVER_STATUSES), enabled: z.boolean(), tools: z.number().int() })),
  requests: z.array(z.object({ id: z.string(), label: z.string(), why: z.string(), createdAt: z.number() })),
});
export const toolGatewayPublicContract = defineRpcContract({
  "toolGateway.overview": { input: z.null(), output: toolGatewayOverviewSchema },
});

/** The methods only the app window may call. */
export const GATED_METHODS = [
  "toolGateway.addServer", "toolGateway.editServer", "toolGateway.approve", "toolGateway.decline",
  "toolGateway.setEnabled", "toolGateway.setToolEnabled", "toolGateway.setScope", "toolGateway.remove",
  "toolGateway.signIn", "toolGateway.finishSignIn", "toolGateway.signOut", "toolGateway.testTool",
  "toolGateway.setProvider", "toolGateway.import", "toolGateway.removeOldPlugin",
] as const satisfies readonly (keyof typeof toolGatewayContract)[];

export const APP_WINDOW_ONLY = "Approve this in the BB Studio app on this Mac.";
