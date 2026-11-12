import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";

export interface ProviderCard {
  providerId: string;
  displayName: string;
  status: string;
  accountEmail: string | null;
  loginCommand: string | null;
}

export const PROVIDER_POLL_MS = 3_000;

const SIGN_IN_STATES = new Set(["unauthenticated", "expired"]);

export const isReady = (card: Pick<ProviderCard, "status">) => card.status === "ready";
export const canSignIn = (card: Pick<ProviderCard, "status" | "loginCommand">) => !!card.loginCommand && SIGN_IN_STATES.has(card.status);
export const anyReady = (cards: readonly Pick<ProviderCard, "status">[] | null) => !!cards?.some(isReady);

const ORDER = ["claude-code", "codex"];

export function sortCards(cards: readonly ProviderCard[]): ProviderCard[] {
  const rank = (card: ProviderCard) => {
    const known = ORDER.indexOf(card.providerId);
    return known === -1 ? ORDER.length : known;
  };
  return [...cards].sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName));
}

export function useProviderCards(enabled = true): ProviderCard[] | null {
  const sdk = useSdk() as unknown as {
    system: {
      config(): Promise<{ primaryHostId?: string | null }>;
      providerStates(args?: { hostId: string }): Promise<{ providers: readonly (Omit<ProviderCard, "accountEmail" | "loginCommand"> & { accountEmail?: string | null; loginCommand?: string | null })[] }>;
    };
  };
  const [cards, setCards] = useState<ProviderCard[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = async () => {
      try {
        const { primaryHostId } = await sdk.system.config();
        const { providers } = await sdk.system.providerStates(primaryHostId ? { hostId: primaryHostId } : undefined);
        if (live) setCards(sortCards(providers.map((each) => ({ providerId: each.providerId, displayName: each.displayName, status: each.status, accountEmail: each.accountEmail ?? null, loginCommand: each.loginCommand ?? null }))));
      } catch {
        if (live) setCards((current) => current ?? []);
      }
    };
    void load();
    const timer = setInterval(() => void load(), PROVIDER_POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [sdk, enabled]);
  return cards;
}
