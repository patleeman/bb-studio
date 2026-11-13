import { useContext, useEffect, useRef } from "react";
import { UNSAFE_LocationContext } from "react-router-dom";
import type { SystemProviderState } from "@bb/server-contract";
import { useSystemProviderStates } from "./queries/system-queries";

const SIGNED_OUT_STATUSES: ReadonlySet<SystemProviderState["status"]> =
  new Set(["unauthenticated", "expired", "not_installed"]);

export function signedInProviderFor(
  providerId: string,
  providers: readonly SystemProviderState[] | undefined,
): string | null {
  if (providerId === "" || providers === undefined) return null;
  const current = providers.find(
    (provider) => provider.providerId === providerId,
  );
  if (current === undefined || !SIGNED_OUT_STATUSES.has(current.status)) {
    return null;
  }
  return (
    providers.find((provider) => provider.status === "ready")?.providerId ??
    null
  );
}

export function useSignedInProviderDefault(args: {
  providerId: string;
  setProviderId: (providerId: string) => void;
  locked: () => boolean;
}): void {
  const visit = useContext(UNSAFE_LocationContext)?.location?.key ?? "";
  const decidedFor = useRef<string | null>(null);
  const states = useSystemProviderStates({
    enabled: args.providerId !== "",
    poll: false,
  });
  const providers = states.data?.providers;
  const { providerId, setProviderId, locked } = args;
  useEffect(() => {
    if (
      decidedFor.current === visit ||
      providers === undefined ||
      providerId === ""
    ) {
      return;
    }
    decidedFor.current = visit;
    if (locked()) return;
    const next = signedInProviderFor(providerId, providers);
    if (next !== null) setProviderId(next);
  }, [locked, providerId, providers, setProviderId, visit]);
}
