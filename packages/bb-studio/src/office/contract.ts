import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { inboxContract } from "./inbox-contract";
export { inboxEventSchema, type InboxEvent } from "./inbox-contract";

const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(100);
export const trustSchema = z.enum(["read_only", "ask", "act"]);
export const officeSpaceSchema = z.object({
  id, name, icon: z.string().max(100).nullable(), description: z.string(),
  isDefault: z.boolean(), defaultProjectId: id.nullable(),
  projectIds: z.array(id), createdAt: z.number(), updatedAt: z.number(),
});
export const spaceSettingsSchema = z.object({
  enabledItemKinds: z.array(id).nullable(),
  defaultTrust: trustSchema,
  defaultBotModel: z.object({ providerId: id, model: id }).nullable(),
});
export const officeItemSchema = z.object({
  pluginId: id, id, kind: id, title: z.string(), href: z.string(),
  projectId: id.nullable(), authorBotId: id.nullable(), updatedAt: z.number(),
});
export const officeThreadSchema = z.object({
  id, title: z.string(), state: z.string(), updatedAt: z.number(),
  authorBotId: id.nullable(),
});
export const folderSchema = z.object({
  id, spaceId: id, name: z.string(), path: z.string().nullable(),
  archived: z.boolean(), isDefault: z.boolean(),
});
const spaceInput = z.object({ name, icon: z.string().max(100).nullable().optional(), description: z.string().max(500).optional() });

/** Office RPCs use project ownership for Space membership. Legacy camelCase
 * RPCs remain separate while the existing UI is replaced. */
export const officeContract = defineRpcContract({
  ...inboxContract,
  spaces_list: { input: z.object({}), output: z.object({ spaces: z.array(officeSpaceSchema) }) },
  space_create: { input: spaceInput, output: z.object({ space: officeSpaceSchema }) },
  space_update: { input: spaceInput.partial().extend({ spaceId: id }), output: z.object({ space: officeSpaceSchema }) },
  space_delete: { input: z.object({ spaceId: id }), output: z.object({ ok: z.boolean() }) },
  space_move_project: { input: z.object({ projectId: id, spaceId: id }), output: z.object({ space: officeSpaceSchema }) },
  space_settings_get: { input: z.object({ spaceId: id }), output: z.object({ settings: spaceSettingsSchema }) },
  space_settings_set: { input: z.object({ spaceId: id, settings: spaceSettingsSchema.partial() }), output: z.object({ settings: spaceSettingsSchema }) },
  folder_create: { input: z.object({ spaceId: id, name }), output: z.object({ folder: folderSchema }) },
  folder_archive: { input: z.object({ folderId: id }), output: z.object({ ok: z.boolean() }) },
  space_tree: { input: z.object({ spaceId: id }), output: z.object({
    space: officeSpaceSchema,
    folders: z.array(folderSchema.extend({ threads: z.array(officeThreadSchema), items: z.array(officeItemSchema) })),
  }) },
});

export type OfficeSpace = z.infer<typeof officeSpaceSchema>;
export type SpaceSettings = z.infer<typeof spaceSettingsSchema>;
export type OfficeFolder = z.infer<typeof folderSchema>;
export type OfficeItem = z.infer<typeof officeItemSchema>;
export type OfficeThread = z.infer<typeof officeThreadSchema>;
export type OfficeInput<M extends keyof typeof officeContract> = z.input<(typeof officeContract)[M]["input"]>;
export type OfficeOutput<M extends keyof typeof officeContract> = z.output<(typeof officeContract)[M]["output"]>;
