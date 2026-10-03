import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import type { StudioHub } from "../hub";
import { StudioServices } from "../services";
import { ProviderComments } from "../provider-comments";
import { commentSource, pageRequestSource } from "./item-sources";
import type { ModuleServices } from "../modules/services";
import { moduleInboxSources } from "./module-sources";
import { officeHome } from "./home";
import { officeTeam } from "./team";
import { delegateOffice } from "./delegation";
import { legacyAttentionSource } from "./legacy-attention";
import { Inbox } from "./inbox";
import { interactionSource } from "./interaction-source";
import { officeContract } from "./contract";
import { FolderService } from "./folders";
import { migrateOfficeSpaces } from "./migration";
import { ProjectSpaceStore } from "./legacy-spaces";

export async function initializeOffice(bb: BbPluginApi, db: Database.Database, hub: StudioHub, options: { folderRoot?: string; moduleServices?: ModuleServices } = {}) {
  const projects = await bb.sdk.projects.list({ includePersonal: true });
  const migrated = db.prepare("SELECT 1 FROM sqlite_master WHERE name='office_migrations'").get()
    && db.prepare("SELECT 1 FROM office_migrations WHERE id='space-root-v1'").get();
  if (!migrated) {
    const { items } = await hub.overview();
    const projectByRef = new Map(items.map(item => [`${item.pluginId}:${item.id}`, item.projectId]));
    const threads = db.prepare("SELECT DISTINCT item_id FROM item_tags WHERE plugin_id='bb-thread'").all() as { item_id: string }[];
    for (const { item_id } of threads) {
      const thread = await bb.sdk.threads.get({ threadId: item_id }).catch(() => null);
      if (thread) projectByRef.set(`bb-thread:${item_id}`, thread.projectId);
    }
    migrateOfficeSpaces(db, { projectIds: projects.map(p => p.id),
      projectForMember: m => projectByRef.get(`${m.pluginId}:${m.id}`), logConflict: m => bb.log.warn(m) });
  }
  const spaces = new ProjectSpaceStore(db);
  spaces.office.reconcileProjects(projects.map(p => p.id));
  const folders = new FolderService(db, spaces.office, {
    root: options.folderRoot ?? join(homedir(), "Spaces"),
    mkdir: async path => { await mkdir(path, { recursive: true }); },
    projects: async () => (await bb.sdk.projects.list({ includePersonal: true })).map(p => ({ id: p.id, name: p.name, path: (p.sources.find(s => s.isDefault) ?? p.sources[0])?.path ?? null })),
    createProject: async (name, path) => {
      const hostId = (await bb.sdk.system.config()).primaryHostId;
      if (!hostId) throw new Error("Connect the primary host before creating a folder.");
      const p = await bb.sdk.projects.create({ name, source: { type: "local_path", hostId, path } });
      return { id: p.id, name: p.name, path };
    },
  });
  const changed = () => bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
  const ensureFolders = async () => { for (const space of spaces.office.list()) await folders.ensureCatchAll(space.id); };
  const inbox = new Inbox(db, [interactionSource(bb.sdk), legacyAttentionSource(db), commentSource(hub, new StudioServices(db), new ProviderComments(bb.sdk)), pageRequestSource(bb.sdk, hub), ...(options.moduleServices ? moduleInboxSources(options.moduleServices) : [])], projectId => spaces.office.forProject(projectId).id);
  const { home: _homeContract, bot_desk: _desk, talk_dm: _dm, talk_list: _talk, ...registeredContract } = officeContract;
  bb.rpc.register(registeredContract, {
    delegate: async input => {
      if (!options.moduleServices) throw new Error("Office modules are unavailable.");
      const result = await delegateOffice(input, options.moduleServices, spaces.office, folders, hub); changed(); return result;
    },
    team_list: ({ spaceId }) => officeTeam(spaceId, spaces.office, inbox, options.moduleServices),
    inbox_list: input => inbox.list(input),
    inbox_counts: () => inbox.counts(spaces.office.list().map(s => s.id)),
    inbox_read: ({ keys }) => { inbox.mark(keys, "read"); changed(); return { ok: true }; },
    inbox_done: ({ keys }) => { inbox.mark(keys, "done"); changed(); return { ok: true }; },
    inbox_act: async ({ key, actionId, text }) => { await inbox.act(key, actionId, text); changed(); return { ok: true }; },
    spaces_list: async () => { spaces.office.reconcileProjects((await bb.sdk.projects.list({ includePersonal: true })).map(p => p.id)); await ensureFolders(); return { spaces: spaces.office.list() }; },
    space_create: async input => {
      // Name uniqueness also makes a lost create response recoverable.
      const space = spaces.office.list().find(s => s.name.toLowerCase() === input.name.trim().toLowerCase()) ?? spaces.office.create(input);
      await folders.ensureCatchAll(space.id); changed(); return { space: spaces.office.get(space.id) };
    },
    space_update: input => { const space = spaces.office.update(input); changed(); return { space }; },
    space_delete: async ({ spaceId }) => {
      const space = spaces.office.get(spaceId);
      if (space.isDefault) throw new Error("The default Space cannot be deleted.");
      const { items, providers } = await hub.overview();
      if (providers.some(p => p.state !== "ready")) throw new Error("Wait for item providers before checking whether this Space is empty.");
      if (items.some(i => i.projectId !== null && space.projectIds.includes(i.projectId))) throw new Error("This Space still contains items.");
      for (const projectId of space.projectIds) {
        if ((await bb.sdk.threads.list({ projectId, limit: 1 })).length) throw new Error("This Space still contains threads.");
      }
      spaces.office.removeEmptySpace(spaceId); changed(); return { ok: true };
    },
    space_move_project: async ({ projectId, spaceId }) => {
      await bb.sdk.projects.get({ projectId });
      const space = spaces.office.moveProject(projectId, spaceId); changed(); return { space };
    },
    space_settings_get: ({ spaceId }) => ({ settings: spaces.office.settings(spaceId) }),
    space_settings_set: ({ spaceId, settings }) => { const result = spaces.office.setSettings(spaceId, settings); changed(); return { settings: result }; },
    folder_create: async ({ spaceId, name }) => { const folder = await folders.create(spaceId, name); changed(); return { folder }; },
    folder_archive: async ({ folderId }) => { await folders.archive(folderId); changed(); return { ok: true }; },
    space_tree: async ({ spaceId }) => {
      await folders.ensureCatchAll(spaceId);
      const listed = (await folders.list(spaceId)).filter(f => !f.archived);
      const { items } = await hub.overview();
      const personal = spaces.office.defaultSpace().defaultProjectId;
      return { space: spaces.office.get(spaceId), folders: await Promise.all(listed.map(async folder => ({
        ...folder,
        threads: (await bb.sdk.threads.list({ projectId: folder.id, archived: false, limit: 1000 })).map(t => ({
          id: t.id, title: t.title ?? "Untitled", state: t.status, updatedAt: t.updatedAt, authorBotId: null,
        })),
        items: items.filter(i => !i.archived && (i.projectId ?? personal) === folder.id && !["space", "bot", "view"].includes(i.kind)).map(i => ({
          pluginId: i.pluginId, id: i.id, kind: i.kind, title: i.title, href: i.href, projectId: i.projectId,
          authorBotId: (i as typeof i & { authorBotId?: string }).authorBotId ?? null, updatedAt: i.updatedAt,
        })),
      }))) };
    },
  });
  return { spaces, folders, home: (spaceId: string) => officeHome(spaceId, inbox, spaces.office, hub, options.moduleServices) };
}
