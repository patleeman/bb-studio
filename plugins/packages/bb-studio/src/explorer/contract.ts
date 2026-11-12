// The Explorer's RPC: the folder tree and what is filed where. Spread into
// Studio's contract (src/contract.ts). Every change publishes Studio's
// realtime channel, so each window's tree reloads.
import { z } from "zod";

const folderId = z.string().min(1).max(100);
const projectId = z.string().min(1).max(200).nullable();
const name = z.string().min(1).max(200);
const target = z.object({ kind: z.enum(["thread", "item"]), id: z.string().min(1).max(200) });
const folder = z.object({ id: z.string(), projectId: z.string().nullable(), parentId: z.string().nullable(), name: z.string(), createdAt: z.number(), sort: z.number() });
const filing = z.object({ kind: z.enum(["thread", "item"]), id: z.string(), folderId: z.string().nullable(), filedBy: z.enum(["user", "agent", "auto"]), filedAt: z.number() });

const sideThread = z.object({ threadId: z.string(), parentThreadId: z.string() });

export const explorerSchemas = {
  /** Every folder, and every thread and item filed in one (or placed at its project's root). */
  /**
   * `sideThreads` are the "Reply in thread" forks of a Bot's replies with the
   * thread each one answers (the tree nests them under it); `runnerThreadIds`
   * are the threads of Bots' runners (the tree keeps them in the project's
   * Automations folder). Both are optional for an older server.
   */
  explorer_tree: { input: z.object({}), output: z.object({ folders: z.array(folder), filing: z.array(filing), sideThreads: z.array(sideThread).optional(), runnerThreadIds: z.array(z.string()).optional() }) },
  /** Makes a folder at a project's root (`projectId` null = No project) or inside `parentId`. */
  explorer_folder_create: { input: z.object({ projectId, parentId: folderId.nullable(), name }), output: z.object({ folder }) },
  explorer_folder_rename: { input: z.object({ id: folderId, name }), output: z.object({ folder }) },
  /** Moves a folder within its project; `parentId` null is the project's root. */
  explorer_folder_move: { input: z.object({ id: folderId, parentId: folderId.nullable() }), output: z.object({ folder }) },
  /** Deletes one folder; what was in it moves up to its parent. */
  explorer_folder_delete: { input: z.object({ id: folderId }), output: z.object({ ok: z.boolean() }) },
  /** The user files things into a folder, or at their project's root (`folderId` null). */
  explorer_file: { input: z.object({ targets: z.array(target).min(1).max(500), folderId: folderId.nullable() }), output: z.object({ ok: z.boolean() }) },
  /** Forgets where things were filed. */
  explorer_unfile: { input: z.object({ targets: z.array(target).min(1).max(500) }), output: z.object({ ok: z.boolean() }) },
};

export type ExplorerFolder = z.infer<typeof folder>;
export type ExplorerFiling = z.infer<typeof filing>;
export type ExplorerSideThread = z.infer<typeof sideThread>;
