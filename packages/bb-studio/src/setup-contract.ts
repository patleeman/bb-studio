// The RPCs behind Studio's Setup page and `bb studio setup`; see setup.ts.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { problemSchema } from "./health-contract";

export const addOnStatusSchema = z.enum(["installed", "not-installed", "disabled", "needs-setup", "broken"]);
export type AddOnStatus = z.infer<typeof addOnStatusSchema>;

export const addOnSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One line from its marketplace entry. */
  summary: z.string(),
  status: addOnStatusSchema,
  /** Why it isn't in "Install all", e.g. only needed for the iOS app. */
  optional: z.string().nullable(),
  /** Its health problems, hidden ones too. */
  problems: z.array(problemSchema),
  /** What its own health check confirmed. */
  passed: z.array(z.string()),
  /** Its health check didn't answer. */
  unanswered: z.string().nullable(),
  /** The CLI command for the one thing to do next, if any. */
  command: z.string().nullable(),
});
export type AddOnEntry = z.infer<typeof addOnSchema>;

export const retiredSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  why: z.string(),
  kept: z.string(),
  deleted: z.string(),
  /** What to do before removing it, as plain steps or commands. */
  before: z.array(z.object({ text: z.string(), command: z.string().nullable() })),
  /** Null when it can be removed now; otherwise why not yet. */
  blocker: z.string().nullable(),
  removeCommand: z.string(),
});
export type RetiredEntry = z.infer<typeof retiredSchema>;

export const setupSummarySchema = z.object({
  checkedAt: z.number(),
  /** False when BB doesn't know the bb-studio marketplace, so installs can't work. */
  marketplaceAdded: z.boolean(),
  marketplaceCommand: z.string(),
  addOns: z.array(addOnSchema),
  retired: z.array(retiredSchema),
  /** Every command left to run, one per line, or empty when there's nothing to do. */
  commands: z.array(z.string()),
  /** Installs every missing add-on that isn't optional, or null when none are missing. */
  installAll: z.string().nullable(),
  /** Problems with plugins that aren't part of BB Studio. */
  otherProblems: z.array(problemSchema),
});
export type SetupSummary = z.infer<typeof setupSummarySchema>;

const pluginId = z.string().min(1).max(100);
const result = z.object({ summary: setupSummarySchema, failures: z.array(z.object({ id: z.string(), error: z.string() })) });
export type SetupActionResult = z.infer<typeof result>;

export const setupContract = defineRpcContract({
  "setup.summary": {
    experimental_description: "BB Studio's add-ons and retired plugins, with what to do next. maxAgeMs: reuse a health result this recent.",
    input: z.object({ maxAgeMs: z.number().int().min(0).max(3_600_000) }).strict(),
    output: setupSummarySchema,
  },
  "setup.install": {
    experimental_description: "Install BB Studio add-ons from the bb-studio marketplace.",
    input: z.object({ pluginIds: z.array(pluginId).min(1).max(50) }).strict(),
    output: result,
  },
  "setup.enable": {
    experimental_description: "Turn an installed BB Studio add-on back on.",
    input: z.object({ pluginId }).strict(),
    output: result,
  },
  "setup.remove": {
    experimental_description: "Remove a retired BB Studio plugin. Deletes its settings, secrets and schedules.",
    input: z.object({ pluginId }).strict(),
    output: result,
  },
});
