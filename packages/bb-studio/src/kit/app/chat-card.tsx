import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { Icon, cn } from "../ui/index";

export const CHAT_CARD = "studio-root studio-card my-2 flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-background text-left text-sm text-foreground";
export const CHAT_CARD_BODY = "px-3 py-2.5";
export const CHAT_CARD_HEAD = "flex min-h-9 min-w-0 items-center gap-2 py-1.5 pr-1.5 pl-3";
export const CHAT_CARD_ICON_BUTTON = "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
export const CHAT_CARD_FOOT = "flex flex-wrap items-center gap-1 border-t border-border/70 px-1.5 py-1";
export const CHAT_CARD_ACTION = "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-3.5";
export const CHAT_CARD_SKELETON = "my-2 h-14 w-full animate-pulse rounded-lg border border-border/70 bg-muted/40 motion-reduce:animate-none";

export function ChatCard({ className, children, ...rest }: ComponentProps<"section">) {
  return <section data-studio-card="" className={cn(CHAT_CARD, className)} {...rest}>{children}</section>;
}

export function ChatCardHeader({ icon, iconClassName, title, meta, actions, onOpen, className, divided = false }: {
  icon: string;
  iconClassName?: string;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  onOpen?(event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }): void;
  className?: string;
  divided?: boolean;
}) {
  const label = (
    <>
      <Icon name={icon} className={cn("size-4 shrink-0 text-muted-foreground", iconClassName)} />
      <span data-studio-card-title="" className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
      {meta ? <span data-studio-card-meta="" className="min-w-0 truncate text-xs text-muted-foreground">{meta}</span> : null}
    </>
  );
  return (
    <header data-studio-card-head="" className={cn(CHAT_CARD_HEAD, divided && "border-b border-border/70", className)}>
      {onOpen
        ? <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">{label}</button>
        : <div className="flex min-w-0 flex-1 items-center gap-2">{label}</div>}
      {actions}
    </header>
  );
}

export function ChatCardIconButton({ icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cn(CHAT_CARD_ICON_BUTTON, className)} {...rest}>
      <Icon name={icon} aria-hidden className="size-3.5" />
    </button>
  );
}

export function ChatCardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <footer data-studio-card-foot="" className={cn(CHAT_CARD_FOOT, className)}>{children}</footer>;
}

export function ChatCardAction({ icon, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string }) {
  return (
    <button type="button" className={cn(CHAT_CARD_ACTION, className)} {...rest}>
      {icon ? <Icon name={icon} aria-hidden /> : null}
      {children}
    </button>
  );
}
