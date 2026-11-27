// Which providers are ACP agents. A custom ACP agent's id starts with "acp-";
// a provider plugin that runs its agent through BB's ACP bridge declares
// `family: "acp"` (provider-antigravity, id "antigravity"). Both take no
// `auto` permission unless they say so, run models from several services,
// and get Studio's tools as per-thread dynamic tools through the bridge's
// session MCP server.
//
// The family comes from BB's provider list (`sdk.providers.list()`, or a
// catalog entry's `info`), noted here as Studio reads it; the checks below
// are synchronous. An id once seen as ACP stays so for the session: being
// treated as ACP only ever narrows (auto lands on accept-edits).

export interface ProviderFamilyInfo { id: string; family?: string | null }
export interface ProviderCatalogInfo { id: string; info?: { family?: string | null } | null }

const declaredAcp = new Set<string>();

export function noteProviders(list: readonly ProviderFamilyInfo[]): void {
  for (const provider of list) if (provider.family === "acp") declaredAcp.add(provider.id);
}

export function noteCatalog(catalog: readonly ProviderCatalogInfo[]): void {
  noteProviders(catalog.map((entry) => ({ id: entry.id, family: entry.info?.family ?? null })));
}

/** True for a custom ACP agent (acp-*) or a provider that declares the ACP family. */
export function isAcpAgent(providerId: string): boolean {
  return providerId.startsWith("acp-") || declaredAcp.has(providerId);
}

interface ProvidersSdk { list(): Promise<readonly unknown[]> }

let lastRefresh = 0;
/** Reads BB's provider list at most every 30 seconds (forced on start); a failed read changes nothing. */
export async function refreshProviderFamilies(sdk: ProvidersSdk, force = false): Promise<void> {
  if (!force && Date.now() - lastRefresh < 30_000) return;
  lastRefresh = Date.now();
  try { noteProviders((await sdk.list()) as ProviderFamilyInfo[]); } catch { /* No list: the prefix alone. */ }
}

/** Tests only. */
export function resetProviderFamilies(): void {
  declaredAcp.clear();
  lastRefresh = 0;
}
