import { useEffect, useState } from "react";
import { OUTLINE_BUTTON } from "../../kit/app/index";
import { cn, Icon } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import type { AccountView, ThreadAccount } from "../contract";
import { reloginTarget, signInLabel } from "./AccountsPanel";
import { openAccounts } from "./store";

const SOURCE_TEXT = { studio: "BB Studio Account Pooler", bb: "bb Account Pooler", local: "This Mac" } as const;

export function SignedOutLine({ name, source, onSignIn, compact = false }: { name: string; source: AccountView["source"]; onSignIn: (() => void) | null; compact?: boolean }) {
  return (
    <div data-testid="signed-out" className={cn("flex min-w-0 items-center gap-2 text-sm", compact ? "py-1" : "")}>
      <Icon name="CircleAlert" className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 truncate"><span className="font-medium text-destructive">Signed out</span><span className="text-muted-foreground"> · {name} · {SOURCE_TEXT[source]}</span></span>
      {onSignIn ? <button type="button" className={cn(OUTLINE_BUTTON, "h-7 px-2.5 text-xs")} onClick={onSignIn}>{signInLabel({ source })}</button> : null}
    </div>
  );
}

export function ThreadSignedOutBanner({ threadId }: { threadId: string }) {
  const call = useCall();
  const live = useLive("accounts.status", {}, { pollMs: 60_000 });
  const [account, setAccount] = useState<ThreadAccount>(null);
  const version = live.data?.checkedAt ?? 0;
  useEffect(() => {
    let current = true;
    void call("accounts.thread", { threadId }).then((next) => { if (current) setAccount(next); }, () => { if (current) setAccount(null); });
    return () => { current = false; };
  }, [call, threadId, version]);
  if (!account || account.state !== "signed_out") return null;
  const full = live.data?.accounts.find((each) => each.key === account.accountKey);
  const signIn = full?.signIn ? () => openAccounts({ key: full.key, target: reloginTarget(full) }) : null;
  return (
    <div data-testid="thread-signed-out" className="studio-root flex shrink-0 items-center px-5 py-1.5">
      <SignedOutLine name={account.name} source={account.source} onSignIn={signIn} />
    </div>
  );
}

const FAMILY_BY_LABEL: Record<string, string> = { "claude code": "claude", claude: "claude", codex: "codex" };

export function pooledFamily(providerLabel: string, detail: string | null): string | null {
  if (!detail || !/account-pool|account pooler/i.test(detail)) return null;
  return FAMILY_BY_LABEL[providerLabel.trim().toLowerCase()] ?? null;
}

export function signedOutPoolAccount(accounts: readonly AccountView[], family: string): AccountView | null {
  const pool = accounts.filter((account) => account.source === "studio" && account.provider === family && account.state !== "disabled");
  if (!pool.length || pool.some((account) => account.state === "ready" || account.state === "limited")) return null;
  return pool.find((account) => account.state === "signed_out") ?? null;
}

export function ModelLoadNotice({ providerLabel, detail }: { providerLabel: string; code: string; detail: string | null }) {
  const family = pooledFamily(providerLabel, detail);
  const live = useLive("accounts.status", {}, { enabled: family !== null, pollMs: 60_000 });
  if (!family || !live.data) return null;
  const account = signedOutPoolAccount(live.data.accounts, family);
  if (!account) return null;
  return <SignedOutLine compact name={account.name} source="studio" onSignIn={account.signIn ? () => openAccounts({ key: account.key, target: reloginTarget(account) }) : null} />;
}
