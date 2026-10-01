import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { eachId, type StudioSchemas } from "../contract";
import { snippets } from "../format";
import { registerStudioProvider, type StudioProviderHandlers, type StudioProviderRegistration } from "./core";

export function mustGet<T>(get: (id: string) => T | null | undefined, id: string, message: string): T {
  const item = get(id);
  if (item == null) throw new Error(message);
  return item;
}

/** Run the common bulk management methods; domain checks remain in callbacks. */
export function storeActions(actions: {
  move(id: string, projectId: string | null): void | Promise<void>;
  archive(id: string, archived: boolean): void | Promise<void>;
  delete(id: string): void | Promise<void>;
}): Pick<StudioProviderHandlers, "studio_move" | "studio_archive" | "studio_delete"> {
  return {
    studio_move: ({ ids, projectId }) => eachId(ids, (id) => actions.move(id, projectId)),
    studio_archive: ({ ids, archived }) => eachId(ids, (id) => actions.archive(id, archived)),
    studio_delete: ({ ids }) => eachId(ids, (id) => actions.delete(id)),
  };
}

export function storeSearch<T extends { id: string }>(options: {
  find(query: string): T[];
  text(item: T): string;
}): StudioProviderHandlers["studio_search"] {
  return ({ query }) => {
    const found = options.find(query);
    return { ids: found.map((item) => item.id), snippets: snippets(found, query, options.text) };
  };
}

/** Register a store-backed Studio provider with the shared bulk methods. */
export function createStoreProvider<T extends { id: string }>(
  bb: Pick<BbPluginApi, "rpc">,
  schemas: StudioSchemas,
  handlers: Omit<StudioProviderRegistration, "studio_move" | "studio_archive" | "studio_delete" | "studio_search">,
  actions: Parameters<typeof storeActions>[0],
  search: Parameters<typeof storeSearch<T>>[0],
): void {
  registerStudioProvider(bb, schemas, { ...handlers, ...storeActions(actions), studio_search: storeSearch(search) });
}
