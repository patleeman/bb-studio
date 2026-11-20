// A row's provider mark in the Bot sidebar: the agent provider a conversation
// or worker runs on, as BB's own pickers draw its logo (experimental_ProviderIcon
// through ProviderLogo), 12 px and muted, left of the title. The host's brand
// tint is left out so it stays one color on every theme. A provider BB doesn't
// list, or none, gets BB's generic agent glyph. Its tooltip and accessible name
// say the provider and the model: "Claude Code · Opus 5.5".
import { ProviderLogo, type ProviderIconRecord } from "../bot/BotAvatar";
import type { ProviderCatalogEntry } from "../bot/ProviderStatusMark";

/** The provider a row runs on and its model's display name, as far as known. */
export interface RowProvider {
  providerId?: string | null;
  modelName?: string | null;
}

export const UNKNOWN_PROVIDER = "Unknown provider";

/** "Claude Code · Opus 5.5": the provider's name in BB's catalog (else its id), and the model once known. */
export function providerLabel(provider: RowProvider | null | undefined, providers: readonly Pick<ProviderCatalogEntry, "id" | "displayName">[]): string {
  const id = provider?.providerId ?? null;
  const name = (id ? providers.find((each) => each.id === id)?.displayName?.trim() || id : null) ?? UNKNOWN_PROVIDER;
  return provider?.modelName ? `${name} · ${provider.modelName}` : name;
}

/** The record BB's icon renderer reads, without the brand tint. */
function iconRecord(providerId: string | null, providers: readonly ProviderCatalogEntry[]): ProviderIconRecord {
  const entry = providers.find((entry) => entry.id === providerId);
  if (!entry) return { id: providerId ?? "unknown" };
  return { id: entry.id, logoUrl: entry.logoUrl ?? null, icon: entry.icon ?? null };
}

export function ProviderMark({ provider, providers, label }: { provider: RowProvider | null | undefined; providers: readonly ProviderCatalogEntry[]; label?: string }) {
  const providerId = provider?.providerId ?? null;
  const known = !!providers.find((entry) => entry.id === providerId);
  const text = label ?? providerLabel(provider, providers);
  return (
    <span role="img" aria-label={text} title={text} data-testid="provider-mark" data-provider-id={providerId ?? ""} data-known={known ? "" : undefined}
      className="flex size-3 shrink-0 items-center justify-center self-center text-[color-mix(in_oklab,var(--foreground)_50%,transparent)]">
      <ProviderLogo provider={iconRecord(providerId, providers)} className="size-3" />
    </span>
  );
}
