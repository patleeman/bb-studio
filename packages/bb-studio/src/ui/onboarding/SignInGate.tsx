import type { ReactNode } from "react";
import { OUTLINE_BUTTON } from "../../kit/app/index";
import { cn } from "../../kit/ui/index";
import { runLinkAction } from "../../links/actions";
import { anyReady, useProviderCards } from "./providers";

export function SignInButton() {
  return (
    <button type="button" data-testid="composer-sign-in" className={cn(OUTLINE_BUTTON, "h-7 px-2.5 text-xs")} onClick={() => { runLinkAction("accounts"); }}>Sign in</button>
  );
}

export function SignInGate({ children }: { hasSelectedModel: boolean; children: ReactNode }) {
  const cards = useProviderCards();
  if (cards === null || anyReady(cards)) return <>{children}</>;
  return <SignInButton />;
}
