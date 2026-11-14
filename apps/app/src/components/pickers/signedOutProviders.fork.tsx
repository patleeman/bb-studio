import { useEffect, useRef } from "react";
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
  });
  return signedOutProviderIds(query.data?.providers);
}

export function signedInFirst<Option extends { value: string }>(
  options: readonly Option[],
  signedOut: ReadonlySet<string>,
): readonly Option[] {
  if (signedOut.size === 0) return options;
  return [
    ...options.filter((option) => !signedOut.has(option.value)),
    ...options.filter((option) => signedOut.has(option.value)),
  ];
}

export function signedInProviderToBrowse(
  options: readonly { value: string }[],
  signedOut: ReadonlySet<string>,
  selectedProviderId: string,
): string | null {
  if (!signedOut.has(selectedProviderId)) return null;
  return options.find((option) => !signedOut.has(option.value))?.value ?? null;
}

export function useBrowseSignedInOnOpen({
  open,
  signedOut,
  selectedProviderId,
  options,
  browsing,
  browse,
}: {
  open: boolean;
  browsing: boolean;
  signedOut: ReadonlySet<string>;
  selectedProviderId: string;
  options: readonly { value: string }[];
  browse: (providerId: string) => void;
}): void {
  const settled = useRef(false);
  useEffect(() => {
    if (!open) {
      settled.current = false;
      return;
    }
    if (settled.current || signedOut === EMPTY) return;
    settled.current = true;
    if (browsing) return;
    const target = signedInProviderToBrowse(options, signedOut, selectedProviderId);
    if (target !== null) browse(target);
  }, [browse, browsing, open, options, selectedProviderId, signedOut]);
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
