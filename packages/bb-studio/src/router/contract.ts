import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// The settings UI imports this contract, and a plugin frontend bundle can't
// resolve the root SDK. The SDK helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

/** BB's picker id for Auto; a rule's chain never names it. */
export const AUTO_ID = "auto";
export const ROUTER_CHANNEL = "studio-router";
export const ROUTER_CALLER = "studio-router";

const reasoningLevel = z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]);
export type RouterReasoningLevel = z.infer<typeof reasoningLevel>;

/** A real provider and model, with the names shown for it. */
export const targetSchema = z.object({
  providerId: z.string().trim().min(1).max(100).refine((id) => id !== AUTO_ID, { message: "A chain names real models, not Auto." }),
  model: z.string().trim().min(1).max(200).refine((id) => id !== AUTO_ID, { message: "A chain names real models, not Auto." }),
  reasoningLevel: reasoningLevel.nullable().default(null),
  label: z.string().trim().max(80).optional(),
}).strict();
export type Target = z.infer<typeof targetSchema>;

export const ruleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/u);
/** "default" is the answer for no rule; a rule can't take it. */
export const DEFAULT_RULE = "default";

export const ruleSchema = z.object({
  id: ruleIdSchema.refine((id) => id !== DEFAULT_RULE, { message: `"${DEFAULT_RULE}" is reserved.` }),
  text: z.string().trim().min(1).max(500),
  chain: z.array(targetSchema).min(1).max(8),
}).strict();
export type Rule = z.infer<typeof ruleSchema>;

export const MAX_RULES = 24;

export const policySchema = z.object({
  /** Auto in the pickers and the usage-limit notice. */
  enabled: z.boolean(),
  /** A new thread that names no model (an agent's worker, the CLI, an automation, a plugin) goes through Auto. */
  autoDefault: z.boolean(),
  rules: z.array(ruleSchema).max(MAX_RULES).refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length, { message: "Rule ids must be unique." }),
  defaultChain: z.array(targetSchema).max(8),
}).strict();
export type Policy = z.infer<typeof policySchema>;

export const defaultPolicy: Policy = { enabled: true, autoDefault: false, rules: [], defaultChain: [] };

export const decisionSourceSchema = z.enum(["jev", "model", "default", "no-rules"]);
export type DecisionSource = z.infer<typeof decisionSourceSchema>;

export const decisionSchema = z.object({
  ruleId: z.string().nullable(),
  source: decisionSourceSchema,
  confidence: z.number().nullable(),
  ms: z.number(),
  target: targetSchema.nullable(),
  skipped: z.array(z.object({ target: targetSchema, why: z.string() })),
  /** Why the pick is not the plain first ready model: no ready model was left, so one whose readiness is unknown was taken. */
  note: z.string().optional(),
  /** The picked model runs with Lean tools (an ACP agent on a local model, by default; Settings › Agent context). */
  lean: z.boolean().optional(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const targetCheckSchema = z.object({
  providerId: z.string(),
  model: z.string(),
  problem: z.string().nullable(),
  /** For a usable target whose readiness BB can't tell: it comes after the ready ones. */
  note: z.string().optional(),
});
export type TargetCheck = z.infer<typeof targetCheckSchema>;

export const noticeKindSchema = z.enum(["usage-limit", "sign-in"]);
export type NoticeKind = z.infer<typeof noticeKindSchema>;

export const noticeSchema = z.object({
  threadId: z.string(),
  requestId: z.string(),
  kind: noticeKindSchema,
  failedProviderId: z.string(),
  failedProviderName: z.string(),
  reason: z.string(),
  target: targetSchema.nullable(),
  targetName: z.string().nullable(),
  /**
   * The permission mode the hand-off thread runs with: the failed thread's,
   * narrowed to one the target offers (never wider). Hand off sets it in the
   * composer and checks it before sending; null when it isn't known.
   */
  permissionMode: z.string().nullable().optional(),
  text: z.string(),
  createdAt: z.number(),
});
export type Notice = z.infer<typeof noticeSchema>;

const threadInput = z.object({ threadId: z.string().trim().min(1).max(200) }).strict();

export const routerContract = defineRpcContract({
  "router.policy.get": { input: z.null(), output: policySchema },
  "router.policy.set": { input: policySchema, output: policySchema },
  /** What Auto would pick for this text right now. Asks Jev (and the title AI service if Jev doesn't answer); starts no thread. */
  "router.explain": { input: z.object({ text: z.string().max(20_000) }).strict(), output: decisionSchema },
  /** Each target in the policy and what keeps it from being picked now (not set up, signed out, a model its provider no longer offers). */
  "router.targets.check": { input: z.null(), output: z.array(targetCheckSchema) },
  "router.notice.get": { input: threadInput, output: noticeSchema.nullable() },
  "router.notice.dismiss": { input: threadInput, output: z.object({ ok: z.literal(true) }) },
  /** After the app's Hand off: cancels the old thread's queued retry and removes the notice. */
  "router.handedOff": { input: threadInput, output: z.object({ cancelledRetries: z.number() }) },
  /**
   * BB's handoff to the notice's target, without the app: a new thread on the
   * target in the same workspace, starting "Continue from @thread:…". The
   * app's Hand off button uses BB's own picker handoff instead.
   */
  "router.handoff": { input: threadInput, output: z.object({ threadId: z.string(), target: targetSchema, cancelledRetries: z.number() }) },
});

/** What the phone reads and does: a conversation's usage-limit or sign-in notice, dismissing it, and Hand off without the app. */
export const routerPublicContract = defineRpcContract({
  "router.notice.get": routerContract["router.notice.get"],
  "router.notice.dismiss": routerContract["router.notice.dismiss"],
  "router.handoff": routerContract["router.handoff"],
});
