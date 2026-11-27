import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { visiblePoll } from "../../kit/app/visible-poll";

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

/**
 * The providers to show: those you can sign in to, and any that is ready
 * without a sign-in (an ACP agent on a local model, OpenCode with its own
 * keys). Without the second kind, a BB whose only ready agents are ACP agents
 * would read as having no model at all, and hide the picker (and Auto).
 */
export function cardsFrom(providers: readonly { providerId: string; displayName: string; status: string; accountEmail?: string | null; loginCommand?: string | null }[]): ProviderCard[] {
  return sortCards(providers
    .filter((each) => !!each.loginCommand || isReady(each))
    .map((each) => ({ providerId: each.providerId, displayName: each.displayName, status: each.status, accountEmail: each.accountEmail ?? null, loginCommand: each.loginCommand ?? null })));
}

/** Whether "Connect a model" is done: a provider you sign in to is ready. A ready agent with no sign-in is listed but doesn't count. */
export function finishesOnboarding(cards: readonly Pick<ProviderCard, "status" | "loginCommand">[] | null): boolean {
  return anyReady(cards?.filter((card) => !!card.loginCommand) ?? null);
}

/** The cards to show: providers with a sign-in, and with `withReadyAgents` also those ready without one. */
export function providerCards(providers: Parameters<typeof cardsFrom>[0], withReadyAgents: boolean): ProviderCard[] {
  return cardsFrom(withReadyAgents ? providers : providers.filter((each) => !!each.loginCommand));
}

/**
 * `withReadyAgents`: also count providers that are ready with no sign-in (for
 * the composer's gate). The first-run "Connect a model" screen leaves it off:
 * an ACP agent with no account check reads as ready as soon as it is
 * installed, which doesn't mean a model is connected.
 */
export function useProviderCards(enabled = true, withReadyAgents = false): ProviderCard[] | null {
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
        if (live) setCards(providerCards(providers, withReadyAgents));
      } catch {
        if (live) setCards((current) => current ?? []);
      }
    };
    void load();
    const stop = visiblePoll(() => void load(), PROVIDER_POLL_MS);
    return () => { live = false; stop(); };
  }, [sdk, enabled, withReadyAgents]);
  return cards;
}
