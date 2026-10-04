import { errorMessage as errorText } from "@bb-studio/kit/format";
export { errorText };
// Finds the Studio add-ons and fans Studio's requests out to them. Add-ons
// publish `studio_describe` for discovery; the suite's own plugins are also
// looked up by id, so an older version that predates Studio can be named.
import { STUDIO_PLUGIN_ID, type StudioItem, type StudioKind, type StudioProviderInfo } from "@bb-studio/kit/contract";
import { discoverProviderSnapshot, fanOutProviders, loadProviderItems, rpcErrorStatus, type ProviderItems } from "@bb-studio/kit/server";
import type { z } from "zod";
import type { ProviderView } from "./contract";
import { schemas } from "./contract";

/** The BB Studio suite, in the order Studio lists it. */
export const SUITE = ["pages", "talk", "excalidraw", "artifacts"];
const CALL_TIMEOUT_MS = 10_000;
const LIVE_STATES = new Set(["running", "degraded", "starting"]);

interface PluginEntry {
  id: string;
  name: string | null;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  version: string;
  updatedAt?: string;
}

export interface HubSdk {
  plugins: {
    list(): Promise<{ plugins: readonly PluginEntry[] }>;
    experimental_discoverRpc(args?: { method?: string }): Promise<readonly { pluginId: string }[]>;
    callRpc<T>(args: { pluginId: string; method: string; input?: never; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T>;
  };
}

type ProviderMethods = typeof schemas.provider;
export type HubItem = StudioItem & { pluginId: string };

/** Kinds Studio provides itself, listed alongside the add-ons'. */
export interface LocalProvider {
  kinds: StudioKind[];
  items(): HubItem[];
}


export class StudioHub {
  private readonly described = new Map<string, { revision: string; expiresAt: number; info: StudioProviderInfo }>();
  private inventory: Map<string, string> | null = null;

  constructor(
    private readonly sdk: HubSdk,
    private readonly local: LocalProvider | null = null,
  ) {}

  private localView(): ProviderView[] {
    return this.local ? [{ pluginId: STUDIO_PLUGIN_ID, name: "Studio", state: "ready", detail: null, panel: null, kinds: this.local.kinds }] : [];
  }

  version(pluginId: string): 1 | 2 | null { return this.described.get(pluginId)?.info.version ?? null; }

  private inventoryMap(plugins: readonly PluginEntry[]): Map<string, string> {
    return new Map(plugins.filter(plugin => plugin.enabled && plugin.id !== STUDIO_PLUGIN_ID)
      .map(plugin => [plugin.id, JSON.stringify([plugin.status, plugin.version, plugin.updatedAt ?? ""])]));
  }

  /** Cheap lifecycle detection on stable hosts, which expose no plugin event hook. */
  async inventoryChanges(): Promise<Set<string>> {
    const next = this.inventoryMap((await this.sdk.plugins.list()).plugins);
    const previous = this.inventory;
    this.inventory = next;
    return new Set(previous ? [...new Set([...previous.keys(), ...next.keys()])].filter(id => previous.get(id) !== next.get(id)) : []);
  }

  call<M extends keyof ProviderMethods>(
    pluginId: string,
    method: M,
    input: z.input<ProviderMethods[M]["input"]>,
  ): Promise<z.output<ProviderMethods[M]["output"]>> {
    if (pluginId === STUDIO_PLUGIN_ID) return Promise.reject(new Error("Studio isn't a provider."));
    return this.sdk.plugins.callRpc({
      pluginId,
      method,
      input: input as never,
      outputSchema: schemas.provider[method].output as unknown as z.ZodType<z.output<ProviderMethods[M]["output"]>>,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  }

  /** Every installed, enabled provider, ready or not. */
  async providers(): Promise<ProviderView[]> {
    return (await this.providerSnapshot()).providers;
  }

  private async providerSnapshot(only?: ReadonlySet<string>): Promise<{ providers: ProviderView[]; discoveryComplete: boolean; installed: Set<string> }> {
    const snapshot = await discoverProviderSnapshot(this.sdk, { method: "studio_describe", known: SUITE, exclude: [STUDIO_PLUGIN_ID] });
    this.inventory ??= this.inventoryMap(snapshot.installed);
    const installed = new Set(snapshot.installed.map((entry) => entry.id));
    for (const id of this.described.keys()) if (!installed.has(id)) this.described.delete(id);
    const candidates = snapshot.providers.filter((entry) => !only || only.has(entry.id));
    const local = !only || only.has(STUDIO_PLUGIN_ID) ? this.localView() : [];
    return { providers: [...await Promise.all(candidates.map((entry) => this.describe(entry))), ...local], discoveryComplete: snapshot.complete, installed };
  }

  private async describe(entry: PluginEntry): Promise<ProviderView> {
    const base = { pluginId: entry.id, name: entry.name ?? entry.id, panel: null, kinds: [] };
    if (!LIVE_STATES.has(entry.status)) {
      this.described.delete(entry.id);
      return { ...base, state: "offline", detail: entry.statusDetail ?? `${base.name} isn't running (${entry.status}).` };
    }
    const revision = `${entry.version}:${entry.updatedAt ?? ""}`;
    const cached = this.described.get(entry.id);
    if (cached?.revision === revision && cached.expiresAt > Date.now() && entry.status !== "starting") return { ...base, state: "ready", detail: null, panel: cached.info.panel, kinds: cached.info.kinds };
    try {
      const info = await this.call(entry.id, "studio_describe", null);
      if (info.version === 2 && info.kinds.some((kind) => !kind.capabilities || kind.mentionProviderId === undefined)) throw new Error("Studio provider v2 is missing capabilities or a mention provider id.");
      if (info.version !== 1 && info.version !== 2) throw new Error(`Unsupported Studio provider version: ${info.version}`);
      info.kinds = info.kinds.map((kind) => ({ ...kind, capabilities: kind.capabilities ?? { create: kind.create !== null, move: true, archive: kind.canArchive, delete: true, rename: true, duplicate: false, export: kind.actions.some((action) => action.id.startsWith("copy")), comments: false, versions: false, links: false }, mentionProviderId: kind.mentionProviderId ?? null }));
      this.described.set(entry.id, { revision, expiresAt: Date.now() + 30_000, info });
      return { ...base, state: "ready", detail: null, panel: info.panel, kinds: info.kinds };
    } catch (error) {
      if (rpcErrorStatus(error) === 404) {
        return { ...base, state: "outdated", detail: `Update ${base.name} to see its items in Studio.` };
      }
      return { ...base, state: "offline", detail: errorText(error) };
    }
  }

  /**
   * Providers and every ready provider's items; a provider that fails to list
   * goes offline. `truncated` names the providers that listed only some.
   */
  async overview(only?: ReadonlySet<string>): Promise<{ providers: ProviderView[]; items: HubItem[]; truncated: Set<string>; discoveryComplete: boolean }> {
    const { providers, discoveryComplete } = await this.providerSnapshot(only);
    const lists = await fanOutProviders(
      providers,
      async (provider) => {
        if (provider.state !== "ready") return { provider, items: [] as HubItem[], truncated: false };
        if (provider.pluginId === STUDIO_PLUGIN_ID) return { provider, items: this.local?.items() ?? [], truncated: false };
        const result = await loadProviderItems(() => this.call(provider.pluginId, "studio_list", null));
        if (result.status !== "ready") return { provider: { ...provider, state: "offline" as const, detail: result.status === "unavailable" ? result.error : null }, items: [] as HubItem[], truncated: false };
        return { provider, items: result.items.map((item) => ({ ...item, pluginId: provider.pluginId })), truncated: !result.complete };
      },
      (provider, error) => ({ provider: { ...provider, state: "offline" as const, detail: errorText(error) }, items: [] as HubItem[], truncated: false }),
    );
    return {
      providers: lists.map((list) => list.provider),
      items: lists.flatMap((list) => list.items),
      truncated: new Set(lists.filter((list) => list.truncated).map((list) => list.provider.pluginId)),
      discoveryComplete,
    };
  }

  async itemsResult(pluginId: string, ids?: string[]): Promise<ProviderItems<HubItem>> {
    if (ids?.length === 0) return { status: "ready", items: [], complete: true };
    if (pluginId === STUDIO_PLUGIN_ID) return { status: "ready", items: this.local?.items().filter((item) => !ids || ids.includes(item.id)) ?? [], complete: true };
    const snapshot = await this.providerSnapshot(new Set([pluginId])).catch(() => null);
    if (!snapshot) return { status: "unavailable", error: "Provider inventory is unavailable." };
    const info = snapshot.providers.find((provider) => provider.pluginId === pluginId);
    if (!info) return snapshot.discoveryComplete || !snapshot.installed.has(pluginId)
      ? { status: "absent" } : { status: "unavailable", error: "Provider discovery is unavailable." };
    if (info.state !== "ready") return { status: "unavailable", error: info.detail ?? "Provider unavailable." };
    const result = await loadProviderItems(() => ids && this.version(pluginId) === 2
      ? this.call(pluginId, "studio_get", { ids }) : this.call(pluginId, "studio_list", null));
    return result.status === "ready" ? { ...result, items: result.items.filter((item) => !ids || ids.includes(item.id)).map((item) => ({ ...item, pluginId })) } : result;
  }

  async get(pluginId: string, ids: string[]): Promise<HubItem[]> {
    const result = await this.itemsResult(pluginId, ids);
    if (result.status === "unavailable") throw new Error(result.error);
    return result.status === "ready" ? result.items : [];
  }

  /**
   * `<plugin>:<id>` keys whose content matches, and the matching text by key
   * where the add-on gave it; providers that fail are skipped.
   */
  async search(query: string, v1Only = false): Promise<{ keys: string[]; snippets: Record<string, string> }> {
    const ready = (await this.providers()).filter((provider) => provider.state === "ready" && provider.pluginId !== STUDIO_PLUGIN_ID && (!v1Only || this.version(provider.pluginId) === 1));
    const results = await Promise.all(
      ready.map((provider) =>
        this.call(provider.pluginId, "studio_search", { query }).then(
          ({ ids, snippets = {} }) => ids.map((id) => ({ key: `${provider.pluginId}:${id}`, snippet: snippets[id] })),
          () => [],
        ),
      ),
    );
    const found = results.flat();
    return {
      keys: found.map((match) => match.key),
      snippets: Object.fromEntries(found.flatMap((match) => (match.snippet ? [[match.key, match.snippet]] : []))),
    };
  }

}
