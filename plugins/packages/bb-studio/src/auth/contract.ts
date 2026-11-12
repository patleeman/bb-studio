import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const POOL_PLUGIN_ID = "account-pool";

export const authEntrySchema = z.object({
  id: z.string(),
  source: z.enum(["pool", "provider", "bb"]),
  provider: z.string(),
  name: z.string(),
  detail: z.string().nullable(),
  signedOut: z.boolean(),
  reason: z.enum(["expired", "signed_out", "turn_error"]).nullable(),
});
export type AuthEntry = z.infer<typeof authEntrySchema>;

export const authStatusSchema = z.object({
  checkedAt: z.number(),
  pool: z.enum(["on", "off"]),
  entries: z.array(authEntrySchema),
});
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const loginSessionSchema = z.object({
  sessionId: z.string(),
  targetId: z.string(),
  name: z.string(),
  flow: z.enum(["device", "browser"]),
  url: z.string().nullable(),
  code: z.string().nullable(),
  acceptsCode: z.boolean(),
  expiresAt: z.number().nullable(),
  pollMs: z.number(),
  state: z.enum(["starting", "waiting", "saved", "failed", "expired"]),
  message: z.string().nullable(),
});
export type LoginSession = z.infer<typeof loginSessionSchema>;

const sessionInput = z.object({ sessionId: z.string().min(1) });

export const authContract = defineRpcContract({
  "auth.status": { input: z.object({ refresh: z.boolean().optional() }), output: authStatusSchema },
  "auth.login.start": { input: z.object({ target: z.string().min(1) }), output: loginSessionSchema },
  "auth.login.poll": { input: sessionInput, output: loginSessionSchema },
  "auth.login.complete": { input: sessionInput.extend({ code: z.string().trim().min(1).max(4096) }), output: loginSessionSchema },
  "auth.login.cancel": { input: sessionInput, output: z.object({ cancelled: z.boolean() }) },
});

export const poolAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(["claude", "codex"]),
  kind: z.enum(["oauth", "api-key"]),
  label: z.string(),
  email: z.string().nullable(),
  enabled: z.boolean(),
  status: z.string(),
  error: z.string().nullable(),
});
export type PoolAccount = z.infer<typeof poolAccountSchema>;

export const poolCodexStartSchema = z.object({
  sessionId: z.string(),
  verificationUri: z.string(),
  userCode: z.string(),
  expiresAt: z.number(),
  intervalMs: z.number(),
});
export const poolCodexPollSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("complete") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export const poolClaudeStartSchema = z.object({ sessionId: z.string(), authorizeUrl: z.string() });
export const poolSavedSchema = z.object({ id: z.string() });
export const poolCancelSchema = z.object({ cancelled: z.boolean() });

export interface ProviderState {
  providerId: string;
  displayName: string;
  status: string;
  planLabel?: string | null;
  accountEmail?: string | null;
  loginCommand?: string | null;
}
