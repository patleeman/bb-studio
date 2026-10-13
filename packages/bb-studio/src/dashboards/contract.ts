// Studio's dashboard RPC methods, `dashboards.*`. The app and iOS call them;
// scripts/gen-contracts.mjs generates the Swift names from public-contract.ts.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  approvalPromptSchema,
  dashboardMetaSchema,
  dashboardViewSchema,
  dataViewSchema,
  LIMITS,
  layoutsSchema,
  opSchema,
  versionViewSchema,
  widgetTypeViewSchema,
} from "./shared";

const id = z.string().min(1).max(200);
const widgetId = z.string().min(1).max(100);
const ok = z.object({ ok: z.boolean() });

export const rpcContract = defineRpcContract({
  "dashboards.list": {
    experimental_description: "Dashboards, newest first (archived ones left out).",
    input: z.null(),
    output: z.object({ dashboards: z.array(dashboardMetaSchema) }),
  },
  "dashboards.get": {
    experimental_description: "One dashboard: widgets in grid order, a layout per breakpoint, each widget's last data, and the library types it uses.",
    input: z.object({ id }),
    output: z.object({ dashboard: dashboardViewSchema.nullable() }),
  },
  "dashboards.create": {
    input: z.object({ name: z.string().max(LIMITS.name).optional(), projectId: z.string().max(200).nullable().optional() }),
    output: z.object({ dashboard: dashboardMetaSchema }),
  },
  "dashboards.rename": {
    input: z.object({ id, name: z.string().trim().min(1).max(LIMITS.name) }),
    output: z.object({ ok: z.boolean(), updatedAt: z.number() }),
  },
  "dashboards.delete": {
    input: z.object({ id }),
    output: ok,
  },
  "dashboards.edit": {
    experimental_description: "Add, move, resize, remove or update widgets; all ops apply or none do.",
    input: z.object({ id, ops: z.array(opSchema).min(1).max(100), expectedUpdatedAt: z.number().optional() }),
    output: z.object({ dashboard: dashboardViewSchema, results: z.array(z.string()) }),
  },
  "dashboards.saveLayout": {
    experimental_description: "The grid's layouts after a drag or resize in edit mode.",
    input: z.object({ id, layouts: layoutsSchema }),
    output: z.object({ updatedAt: z.number() }),
  },
  "dashboards.view": {
    experimental_description: "Heartbeat while a client shows the dashboard (every 30 s); url and script widgets refresh only while one does. leave: true when it closes.",
    input: z.object({ id, clientId: z.string().min(1).max(100), leave: z.boolean().optional() }),
    output: ok,
  },
  "dashboards.refresh": {
    experimental_description: "Refresh url and approved script widgets now (one widget, or all); each at most every 10 s.",
    input: z.object({ id, widgetId: widgetId.optional() }),
    output: z.object({ refreshed: z.array(z.string()), data: z.array(dataViewSchema) }),
  },
  "dashboards.setData": {
    experimental_description: "Push data to a widget with a push source.",
    input: z.object({ id, widgetId, data: z.unknown() }),
    output: z.object({ data: dataViewSchema }),
  },
  "dashboards.requestApproval": {
    experimental_description: "Opens the approval dialog for a script widget: the exact command, folder, host, schedule and limits, and a one-time nonce. Only while a BB window shows the dashboard.",
    input: z.object({ id, widgetId }),
    output: z.object({ prompt: approvalPromptSchema }),
  },
  "dashboards.cancelApproval": {
    experimental_description: "Deny, or the approval dialog closing: its nonce stops working.",
    input: z.object({ nonce: z.string().min(16).max(200) }),
    output: ok,
  },
  "dashboards.approveScript": {
    experimental_description: "The user's Approve in the approval dialog. Needs the dialog's nonce: one use, at most 5 minutes old, for the command shown (sha256), on the dashboard as it was when the dialog opened.",
    input: z.object({ id, widgetId, sha256: z.string().regex(/^[0-9a-f]{64}$/), nonce: z.string().min(16).max(200) }),
    output: ok,
  },
  "dashboards.revokeScript": {
    input: z.object({ id, widgetId }),
    output: ok,
  },
  "dashboards.versions": {
    experimental_description: "The dashboard's last 20 versions, newest first.",
    input: z.object({ id }),
    output: z.object({ versions: z.array(versionViewSchema) }),
  },
  "dashboards.restoreVersion": {
    input: z.object({ id, versionId: z.number().int() }),
    output: z.object({ dashboard: dashboardViewSchema }),
  },
  "dashboards.widgetTypes": {
    experimental_description: "The custom widget library.",
    input: z.null(),
    output: z.object({ types: z.array(widgetTypeViewSchema) }),
  },
  "dashboards.saveWidgetType": {
    input: z.object({
      id: z.string().max(100).optional(),
      name: z.string().trim().min(1).max(LIMITS.title),
      description: z.string().max(2000).optional(),
      html: z.string().min(1),
      defaultOptions: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.object({ type: widgetTypeViewSchema }),
  },
  "dashboards.deleteWidgetType": {
    input: z.object({ id: z.string().min(1).max(100) }),
    output: ok,
  },
});
