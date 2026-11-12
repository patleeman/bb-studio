import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export { ACCOUNTS_CHANNEL, WARNINGS_WINDOW_ID, WARN_AT } from "./shared";

export const accountSourceSchema = z.enum(["studio", "bb", "local"]);
export type AccountSource = z.infer<typeof accountSourceSchema>;

export const accountStateSchema = z.enum(["ready", "signed_out", "error", "limited", "disabled"]);
export type AccountState = z.infer<typeof accountStateSchema>;

export const quotaWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  percent: z.number().nullable(),
  resetAt: z.number().nullable(),
  rejected: z.boolean(),
});
export type QuotaWindow = z.infer<typeof quotaWindowSchema>;

export const pinnedThreadSchema = z.object({ threadId: z.string(), title: z.string() });
export type PinnedThread = z.infer<typeof pinnedThreadSchema>;

export const accountViewSchema = z.object({
  key: z.string(),
  id: z.string(),
  source: accountSourceSchema,
  provider: z.string(),
  name: z.string(),
  label: z.string().nullable(),
  state: accountStateSchema,
  message: z.string().nullable(),
  windows: z.array(quotaWindowSchema),
  models: z.array(quotaWindowSchema),
  pinned: z.array(pinnedThreadSchema),
  signIn: z.string().nullable(),
});
export type AccountView = z.infer<typeof accountViewSchema>;

export const warningSchema = z.object({
  id: z.string(),
  accountKey: z.string(),
  source: accountSourceSchema,
  kind: z.enum(["signed_out", "error", "window", "model"]),
  title: z.string(),
  detail: z.string().nullable(),
  action: z.enum(["sign_in", "use_other", "switch_model"]),
  target: z.string().nullable(),
});
export type Warning = z.infer<typeof warningSchema>;

export const sourceStatusSchema = z.object({
  source: accountSourceSchema,
  name: z.string(),
  state: z.enum(["on", "off", "unreachable"]),
});
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const accountsStatusSchema = z.object({
  checkedAt: z.number(),
  sources: z.array(sourceStatusSchema),
  accounts: z.array(accountViewSchema),
  warnings: z.array(warningSchema),
  dismissed: z.array(z.string()),
});
export type AccountsStatus = z.infer<typeof accountsStatusSchema>;

export const threadAccountSchema = z.object({
  accountKey: z.string().nullable(),
  source: accountSourceSchema,
  name: z.string(),
  state: accountStateSchema,
  signIn: z.string().nullable(),
}).nullable();
export type ThreadAccount = z.infer<typeof threadAccountSchema>;

export const accountsContract = defineRpcContract({
  "accounts.status": {
    experimental_description: "Every Account Pooler account (BB Studio's and bb's) and every local provider login: status, quota windows, per-model limits, pinned threads, and the open warnings. Never returns tokens.",
    input: z.object({ refresh: z.boolean().optional() }),
    output: accountsStatusSchema,
  },
  "accounts.dismiss": {
    experimental_description: "Dismiss one account warning until that account's state changes.",
    input: z.object({ id: z.string().min(1).max(400) }),
    output: z.object({ dismissed: z.boolean() }),
  },
  "accounts.useOther": {
    experimental_description: "Move BB Studio's other ready Account Pooler account of the same provider ahead of this one.",
    input: z.object({ accountKey: z.string().min(1).max(200) }),
    output: z.object({ accountKey: z.string().nullable() }),
  },
  "accounts.thread": {
    experimental_description: "The sign-in a thread runs on when it is signed out, or null.",
    input: z.object({ threadId: z.string().min(1) }),
    output: threadAccountSchema,
  },
  "accounts.request": {
    experimental_description: "Ask BB's main window to open Accounts, and the sign-in for one account when given.",
    input: z.object({ signIn: z.string().min(1).max(200).nullable() }),
    output: z.object({ ok: z.literal(true) }),
  },
});
