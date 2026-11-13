import type { ReactNode } from "react";
import { useHostTabWindow } from "../../kit/app/host-sdk";

export interface BotPageFact { label: string; value: ReactNode }

export function BotItemError({ message }: { message: string }) {
  return <p role="alert" data-testid="bot-item-error" className="p-5 text-sm text-destructive">{message}</p>;
}

export function BotItemDetail({ title, facts, actions, after, testId, children }: { title: ReactNode; facts?: readonly BotPageFact[]; actions?: ReactNode; after?: ReactNode; testId?: string; children?: ReactNode }) {
  const tabWindow = useHostTabWindow();
  return (
    <div data-testid={testId} data-bot-item-detail="" className="studio-root flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-col">
        {tabWindow ? <div className="pt-4" /> : <h2 data-testid="bot-item-title" className="px-5 pt-4 pb-3 text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{title}</h2>}
        <div className="flex flex-col gap-4 px-5 pb-6">
          {children}
          {facts?.length ? (
            <dl data-testid="bot-item-facts" className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              {facts.map((fact) => (
                <div key={fact.label} className="contents">
                  <dt className="text-muted-foreground">{fact.label}</dt>
                  <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {actions ? <div data-testid="bot-item-actions" className="flex flex-wrap items-center gap-2 border-t border-border pt-4">{actions}</div> : null}
          {after}
        </div>
      </div>
    </div>
  );
}
