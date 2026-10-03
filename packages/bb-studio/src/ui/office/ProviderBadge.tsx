// The logo of the outside agent a bot runs on (Hermes, OpenClaw, Dot), as
// BB's provider registry draws it, so a new provider's mark appears with no
// office change.
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
} from "@get-bb/plugin-sdk/app";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn, PORTAL_SCOPE } from "./styles";

export function ProviderBadge({ providerId, label, className }: { providerId: string; label: string; className?: string }) {
  const { providers } = useProviders();
  const provider = providers.find((entry) => entry.id === providerId);
  return (
    <span
      aria-hidden
      title={label}
      className={cn("flex items-center justify-center overflow-hidden rounded-full border border-sidebar bg-background text-foreground shadow-sm", className)}
    >
      <ProviderIcon
        providerKind="agent"
        provider={provider ? { id: provider.id, logoUrl: provider.logoUrl ?? null, icon: provider.icon ?? null } : { id: providerId }}
        fallback="Globe"
        className="size-[70%]"
      />
    </span>
  );
}

/** A short tooltip in BB's style, for faces and icon-only controls. */
export function Hint({ label, children, side = "bottom", delay = 250 }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; delay?: number }) {
  return (
    <Tooltip.Provider delayDuration={delay}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content {...PORTAL_SCOPE}
            side={side}
            sideOffset={6}
            className="z-50 max-w-64 rounded-md bg-foreground px-2 py-1 text-xs leading-snug text-background shadow-md motion-safe:animate-in motion-safe:fade-in"
          >
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
