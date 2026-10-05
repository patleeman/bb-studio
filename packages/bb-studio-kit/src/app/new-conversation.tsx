import { experimental_NewThreadComposer as NewThreadComposer } from "@get-bb/plugin-sdk/app";
import { useState, type ComponentProps } from "react";
import { errorMessage, quoteMessage, type ItemQuote } from "../format";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import { OpenInSplitButton, type ItemThread } from "./item-header";

export type ConversationSubmit = NonNullable<ComponentProps<typeof NewThreadComposer>["onSubmit"]>;

export interface NewConversationProps {
  title: string;
  icon?: string;
  ariaLabel?: string;
  placeholder?: string;
  initialPrompt?: string;
  quote?: ItemQuote;
  draftKey: string;
  focusRequest?: number;
  defaultProjectId?: string;
  className?: string;
  composerClassName?: string;
  onSubmit: ConversationSubmit;
  onClose?: () => void;
  moveTarget?: ItemThread;
}

export function NewConversationComposer({ title, icon = "MessageSquare", ariaLabel, placeholder = "What would you like to work on?", initialPrompt, quote, draftKey, focusRequest, defaultProjectId, className, composerClassName, onSubmit, onClose, moveTarget }: NewConversationProps) {
  const [error, setError] = useState<string | null>(null);
  return <section data-studio-conversation="" aria-label={ariaLabel ?? title} className={cn("flex h-full min-h-0 flex-col bg-background text-foreground", className)}>
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
      <Icon name={icon} className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {moveTarget ? <OpenInSplitButton item={moveTarget} /> : null}
      {onClose ? <button type="button" aria-label="Close composer" onClick={onClose} className="rounded p-1 hover:bg-state-hover"><Icon name="X" className="size-4" /></button> : null}
    </header>
    {quote?.image ? <div className="flex shrink-0 items-center gap-3 px-3 pt-2"><img src={quote.image} alt="Selected image area" className="max-h-24 max-w-40 rounded border border-border object-contain" /></div> : null}
    {error ? <p role="alert" className="shrink-0 px-3 pt-2 text-xs text-destructive">{error}</p> : null}
    <NewThreadComposer
      className={cn("studio-conversation-composer min-h-0 flex-1 overflow-auto", composerClassName)}
      layout="document"
      placeholder={placeholder}
      draftKey={draftKey}
      {...(quote ? { initialPrompt: quoteMessage(quote) } : initialPrompt !== undefined ? { initialPrompt } : {})}
      {...(focusRequest !== undefined ? { focusRequest } : {})}
      {...(defaultProjectId ? { defaultProjectId } : {})}
      onSubmit={async request => {
        setError(null);
        try {
          await onSubmit(quote?.image ? { ...request, input: [...request.input, { type: "image", url: quote.image }] } : request);
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
        }
      }}
    />
  </section>;
}
