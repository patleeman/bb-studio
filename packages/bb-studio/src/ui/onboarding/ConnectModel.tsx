import { useEffect, useState } from "react";
import { OUTLINE_BUTTON } from "../../kit/app/index";
import { cn } from "../../kit/ui/index";
import { ReloginFlow, useReloginApi } from "../../auth/ui/ReloginDialog";
import { useLive } from "../live";
import { anyReady, canSignIn, useProviderCards, type ProviderCard } from "./providers";

const STATE_TEXT: Record<string, string> = { ready: "Ready", unauthenticated: "Signed out", expired: "Signed out", not_installed: "Not installed", unsupported_version: "Update needed" };
const STATE_TONE: Record<string, string> = {
  ready: "bg-success/15 text-success",
  unauthenticated: "bg-destructive/15 text-destructive",
  expired: "bg-destructive/15 text-destructive",
};

export function ProviderSignInCard({ card, signingIn, onSignIn, onDone }: { card: ProviderCard; signingIn: boolean; onSignIn(): void; onDone(): void }) {
  const api = useReloginApi();
  return (
    <li data-provider={card.providerId} data-provider-state={card.status} className="flex flex-col gap-2 rounded-lg border border-border/70 bg-foreground/[0.025] p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{card.displayName}</span>
          {card.accountEmail ? <span className="truncate text-xs text-muted-foreground">{card.accountEmail}</span> : null}
        </span>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", STATE_TONE[card.status] ?? "bg-foreground/[0.06] text-muted-foreground")}>{STATE_TEXT[card.status] ?? "Unavailable"}</span>
      </div>
      {signingIn ? (
        <div className="rounded-md border border-border/70 bg-background/40 p-2">
          <ReloginFlow compact target={{ id: `provider:${card.providerId}`, name: card.displayName, detail: "This Mac" }} api={api} onClose={onDone} />
        </div>
      ) : canSignIn(card) ? (
        <div className="flex justify-end">
          <button type="button" data-testid="provider-sign-in" className={OUTLINE_BUTTON} onClick={onSignIn}>Sign in</button>
        </div>
      ) : null}
    </li>
  );
}

export function ConnectModelView({ cards, onSkip }: { cards: ProviderCard[] | null; onSkip(): void }) {
  const [signingIn, setSigningIn] = useState<string | null>(null);
  return (
    <div data-testid="connect-model" className="studio-root flex h-full w-full items-start justify-center overflow-y-auto px-6 py-16">
      <div className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-xl font-semibold text-foreground">Connect a model</h1>
        {cards === null ? <p className="text-sm text-muted-foreground">Loading</p> : null}
        {cards?.length === 0 ? <p className="text-sm text-muted-foreground">No agent providers found</p> : null}
        {cards?.length ? (
          <ul className="flex flex-col gap-2">
            {cards.map((card) => (
              <ProviderSignInCard key={card.providerId} card={card} signingIn={signingIn === card.providerId} onSignIn={() => setSigningIn(card.providerId)} onDone={() => setSigningIn(null)} />
            ))}
          </ul>
        ) : null}
        <button type="button" data-testid="connect-skip" className="self-start text-sm text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground" onClick={onSkip}>Skip for now</button>
      </div>
    </div>
  );
}

export function ConnectModel({ finish }: { finish(): void }) {
  const welcome = useLive("bot_welcome", {}, { pollMs: 3_000 });
  const fresh = welcome.data?.pending === true;
  const cards = useProviderCards(fresh);
  const ready = anyReady(cards);
  useEffect(() => {
    if (welcome.data && !welcome.data.pending) finish();
  }, [welcome.data, finish]);
  useEffect(() => {
    if (ready) finish();
  }, [ready, finish]);
  if (!fresh) return null;
  return <ConnectModelView cards={cards} onSkip={finish} />;
}


