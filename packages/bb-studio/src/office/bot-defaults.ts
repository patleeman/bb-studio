import type Database from "better-sqlite3";
import { OfficeSpaceStore } from "./space-store";
import { permissionForTrust } from "./trust";

/** Explicit bot choices win; otherwise use its owning Space's defaults. */
export function botDefaults(input: { trust?: "ask" | "act"; providerId: string; model: string }, projectId: string, db?: Database.Database) {
  const spaces = db ? new OfficeSpaceStore(db) : null;
  const settings = spaces ? spaces.settings(spaces.forProject(projectId).id) : null;
  const trust = input.trust ?? settings?.defaultTrust ?? "ask";
  const model = !input.model && settings?.defaultBotModel ? settings.defaultBotModel : { providerId: input.providerId, model: input.model };
  return { ...model, trust, permissionMode: permissionForTrust(trust) };
}
