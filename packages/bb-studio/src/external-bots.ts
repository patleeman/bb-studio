// Import bot (src/bot.ts external bots): which Studio Agents providers a bot
// can run on right now. A provider is registered with BB only while it is
// enabled in Studio Agents' settings, so BB's provider list says "enabled";
// Studio Agents' health RPC says whether its endpoint answers.
import type { ExternalProvidersView } from "./contract";
import { EXTERNAL_PROVIDERS } from "./external-providers";

type Provider = ExternalProvidersView["providers"][number];
type Health = { online: boolean; status: string; message: string };

export interface ExternalProviderDeps {
  /** BB's registered agent providers (id, display name, logo). */
  registered(): Promise<readonly { id: string; displayName: string; logoUrl?: string | null }[]>;
  /** Studio Agents' health RPC; throws when the plugin isn't installed. */
  health(provider: string): Promise<Health>;
  /** BB's model catalog for one provider. */
  models(providerId: string): Promise<readonly { id: string; model: string; displayName: string; isDefault: boolean }[]>;
}

export async function externalProviders(deps: ExternalProviderDeps): Promise<ExternalProvidersView> {
  const registered = await deps.registered().catch(() => []);
  let installed = true;
  const providers = await Promise.all(EXTERNAL_PROVIDERS.map(async ({ id, displayName }): Promise<Provider> => {
    const info = registered.find((each) => each.id === id);
    const base = { id, displayName: info?.displayName ?? displayName, logoUrl: info?.logoUrl ?? null, models: [] };
    let health: Health;
    try { health = await deps.health(id); } catch {
      installed = false;
      return { ...base, status: "missing", message: "Install Studio Agents to import bots from external agents." };
    }
    if (health.status === "disabled" || !info) return { ...base, status: "disabled", message: `${displayName} is off. Turn it on in Studio Agents settings.` };
    if (!health.online) return { ...base, status: health.status === "unauthenticated" ? "unauthenticated" : "offline", message: health.message };
    try {
      const models = (await deps.models(id)).map((each) => ({ id: each.model || each.id, displayName: each.displayName || each.model || each.id, isDefault: each.isDefault }));
      return { ...base, status: "ready", message: health.message, models };
    } catch {
      return { ...base, status: "offline", message: `${displayName} didn't list its models.` };
    }
  }));
  return { installed, providers };
}
