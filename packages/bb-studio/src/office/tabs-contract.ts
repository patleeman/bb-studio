import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
const id = z.string().min(1).max(200);
export const tabRefSchema = z.string().max(500).regex(/^(split:[^:]+|thread:[^:]+|item:[^:]+:.+|bot:[^:]+|conversation:[^:]+|office:(inbox|home)|library(?::[^:]+)?)$/);
export const tabZoneSchema = z.enum(["essential", "pinned", "today", "archived"]);
export const todayArchiveAfterSchema = z.enum(["12h", "1d", "3d", "7d", "never"]);
// Splits cannot contain splits, so members have a finite, non-recursive schema.
export const tabTargetSchema = z.object({
  ref: tabRefSchema, kind: z.enum(["thread", "item", "bot", "conversation", "inbox", "home", "library"]),
  title: z.string().nullable(), icon: z.string().nullable(), href: z.string().nullable(),
  itemKind: z.string().optional(), providerId: z.string().optional(), botState: z.enum(["idle", "working", "needs_you"]).optional(),
  badge: z.number().int().nonnegative().optional(), needsYou: z.boolean().optional(), unread: z.boolean().optional(),
});
export const officeTabTargetSchema = tabTargetSchema.extend({
  kind: z.enum(["thread", "item", "bot", "conversation", "inbox", "home", "library", "split"]),
  members: z.array(tabTargetSchema).min(2).max(4).optional(),
});
export const officeTabSchema = officeTabTargetSchema.extend({
  zone: tabZoneSchema, folderId: id.nullable(), openedAt: z.number(), archivedAt: z.number().nullable(),
});
export const tabFolderSchema = z.object({ id, name: z.string(), open: z.boolean(), position: z.number().int().nonnegative() });
const space = z.object({ spaceId: id });
const name = z.string().trim().min(1).max(100);
const ok = z.object({ ok: z.literal(true) });
export const officeTabsContract = defineRpcContract({
  tabs_split_create: { input: space.extend({ refs: z.array(tabRefSchema.refine(ref => !ref.startsWith("split:"), "Splits cannot contain splits")).min(2).max(4).refine(refs => new Set(refs).size === refs.length, "Split members must be distinct"), zone: tabZoneSchema.optional(), folderId: id.nullable().optional() }), output: z.object({ tab: officeTabSchema }) },
  tabs_split_remove: { input: space.extend({ ref: z.string().regex(/^split:[^:]+$/).max(500) }), output: ok },
  tabs_move_space: { input: space.extend({ ref: tabRefSchema, toSpaceId: id }), output: z.object({ tab: officeTabSchema }) },
  tabs_reopen: { input: space, output: z.object({ tab: officeTabSchema.nullable() }) },
  tabs_close_many: { input: space.extend({ refs: z.array(tabRefSchema).max(10000) }), output: ok },
  tabs_get: { input: space, output: z.object({ seeded: z.boolean(), essentials: z.array(officeTabSchema), pinned: z.array(officeTabSchema), folders: z.array(tabFolderSchema), today: z.array(officeTabSchema) }) },
  tabs_seed: { input: space.extend({ pinnedThreadIds: z.array(id).max(10000) }), output: ok },
  tabs_open: { input: z.union([space.extend({ follow: z.boolean().optional(), ref: tabRefSchema, href: z.never().optional() }), space.extend({ follow: z.boolean().optional(), href: z.string().min(1).max(4000), ref: z.never().optional() })]), output: z.object({ tab: officeTabSchema.nullable(), spaceId: id }) },
  tabs_move: { input: space.extend({ ref: tabRefSchema, zone: tabZoneSchema, folderId: id.nullable().optional(), index: z.number().int().nonnegative().optional() }), output: ok },
  tabs_archived: { input: space.extend({ query: z.string().max(1000).optional(), limit: z.number().int().min(1).max(100).optional() }), output: z.object({ tabs: z.array(officeTabSchema) }) },
  tab_folder_create: { input: space.extend({ name }), output: z.object({ folder: tabFolderSchema }) },
  tab_folder_update: { input: z.object({ folderId: id, name: name.optional(), open: z.boolean().optional(), position: z.number().int().nonnegative().optional() }), output: z.object({ folder: tabFolderSchema }) },
  tab_folder_delete: { input: z.object({ folderId: id }), output: ok },
  office_search: { input: space.extend({ query: z.string().max(1000), limit: z.number().int().min(1).max(100).optional() }), output: z.object({ results: z.array(officeTabSchema) }) },
});
export type Tab = z.infer<typeof officeTabSchema>;
export type TabZone = z.infer<typeof tabZoneSchema>;
export type TabFolder = z.infer<typeof tabFolderSchema>;
export type TabTarget = z.infer<typeof officeTabTargetSchema>;
