import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
const id = z.string().min(1).max(200);
export const tabRefSchema = z.string().max(500).regex(/^(thread:[^:]+|item:[^:]+:.+|bot:[^:]+|conversation:[^:]+|office:(inbox|home)|library(?::[^:]+)?)$/);
export const tabZoneSchema = z.enum(["essential", "pinned", "today", "archived"]);
export const todayArchiveAfterSchema = z.enum(["12h", "1d", "3d", "7d", "never"]);
export const officeTabSchema = z.object({
  ref: tabRefSchema, kind: z.enum(["thread", "item", "bot", "conversation", "inbox", "home", "library"]),
  title: z.string().nullable(), icon: z.string().nullable(), href: z.string().nullable(),
  zone: tabZoneSchema, folderId: id.nullable(), openedAt: z.number(), archivedAt: z.number().nullable(),
  itemKind: z.string().optional(), providerId: z.string().optional(), botState: z.enum(["idle", "working", "needs_you"]).optional(),
  badge: z.number().int().nonnegative().optional(), needsYou: z.boolean().optional(), unread: z.boolean().optional(),
});
export const tabFolderSchema = z.object({ id, name: z.string(), open: z.boolean(), position: z.number().int().nonnegative() });
const space = z.object({ spaceId: id });
const name = z.string().trim().min(1).max(100);
const ok = z.object({ ok: z.literal(true) });
export const officeTabsContract = defineRpcContract({
  tabs_get: { input: space, output: z.object({ seeded: z.boolean(), essentials: z.array(officeTabSchema), pinned: z.array(officeTabSchema), folders: z.array(tabFolderSchema), today: z.array(officeTabSchema) }) },
  tabs_seed: { input: space.extend({ pinnedThreadIds: z.array(id).max(10000) }), output: ok },
  tabs_open: { input: z.union([space.extend({ ref: tabRefSchema, href: z.never().optional() }), space.extend({ href: z.string().min(1).max(4000), ref: z.never().optional() })]), output: z.object({ tab: officeTabSchema.nullable() }) },
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
export type TabTarget = Omit<Tab, "zone" | "folderId" | "openedAt" | "archivedAt">;
