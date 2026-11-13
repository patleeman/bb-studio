import { cn, Icon } from "../../kit/ui/index";
import type { SidebarSectionProps } from "../../kit/app/host-sdk";
import { useLive } from "../../ui/live";
import type { AccountsStatus, Warning } from "../contract";
import { toggleAccounts } from "./store";

const exhausted = (warning: Warning) => (warning.kind === "window" || warning.kind === "model") && warning.id.endsWith(":rejected");
const needsSignIn = (warning: Warning) => warning.kind === "signed_out" || warning.kind === "error";

export function attentionWarnings(status: Pick<AccountsStatus, "warnings"> | null | undefined): Warning[] {
  return (status?.warnings ?? []).filter((warning) => needsSignIn(warning) || exhausted(warning));
}

export function noticeText(status: Pick<AccountsStatus, "warnings" | "accounts"> | null | undefined): string | null {
  const warnings = attentionWarnings(status);
  const first = warnings[0];
  if (!first) return null;
  const name = status?.accounts.find((account) => account.key === first.accountKey)?.name;
  const text = needsSignIn(first) && name ? `${name} needs sign-in` : first.title;
  return warnings.length > 1 ? `${text} · +${warnings.length - 1}` : text;
}

export function AccountsNoticePill({ text, severe, onOpen }: { text: string; severe: boolean; onOpen(): void }) {
  return (
    <button
      type="button"
      data-testid="accounts-notice"
      title={text}
      onClick={onOpen}
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border px-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        severe ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15" : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/15",
      )}
    >
      <Icon name={severe ? "CircleAlert" : "AlertTriangle"} className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <Icon name="ChevronRight" className="size-3.5 shrink-0 opacity-70" />
    </button>
  );
}

export function AccountsNotice({ placement }: SidebarSectionProps) {
  const footer = placement === "footer";
  const live = useLive("accounts.status", {}, { enabled: footer, pollMs: 60_000 });
  if (!footer) return null;
  const text = noticeText(live.data);
  if (!text) return null;
  const severe = attentionWarnings(live.data).some(needsSignIn);
  return (
    <div className="studio-root px-2 pb-1 pt-1.5">
      <AccountsNoticePill text={text} severe={severe} onOpen={toggleAccounts} />
    </div>
  );
}
