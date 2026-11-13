import type { SystemProviderState, SystemProvidersQuery } from "@bb/server-contract";
import { useSystemProviderStates } from "@/hooks/queries/system-queries";

const SIGNED_OUT: ReadonlySet<SystemProviderState["status"]> = new Set([
  "unauthenticated",
  "expired",
]);

const EMPTY: ReadonlySet<string> = new Set();

export function signedOutProviderIds(
  providers: readonly SystemProviderState[] | undefined,
): ReadonlySet<string> {
  if (providers === undefined) return EMPTY;
  return new Set(
    providers
      .filter((provider) => SIGNED_OUT.has(provider.status))
      .map((provider) => provider.providerId),
  );
}

export function useSignedOutProviderIds(
  routing: SystemProvidersQuery | undefined,
  enabled: boolean,
): ReadonlySet<string> {
  const query = useSystemProviderStates({
    environmentId: routing?.environmentId,
    hostId: routing?.hostId,
    enabled,
    poll: false,
  });
  return signedOutProviderIds(query.data?.providers);
}

export function SignedOutTabMark({ signedOut }: { signedOut: boolean }) {
  if (!signedOut) return null;
  return (
    <span
      role="img"
      aria-label="Not signed in"
      title="Not signed in"
      data-testid="provider-tab-signed-out"
      className="-ml-0.5 mb-2.5 size-1.5 shrink-0 rounded-full bg-destructive"
    />
  );
}
