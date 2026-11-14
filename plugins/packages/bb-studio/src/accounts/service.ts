import type Database from "better-sqlite3";
import type { AuthStatus, ProviderState } from "../auth/contract";
import { isProxied, providerFamily } from "../auth/detect";
import type { AccountView, AccountsStatus, PinnedThread, QuotaWindow, SourceStatus, ThreadAccount } from "./contract";
import { localAccountViews, poolAccountView, type PoolSignals, type PoolStatusView } from "./pool-view";
import { accountOfWarning, computeWarnings } from "./warnings";

const FRESH_MS = 30_000;

export class WarningStore {
  constructor(private readonly db: Database.Database) {}

  list(): string[] {
    return (this.db.prepare("SELECT id FROM account_warnings ORDER BY id").all() as { id: string }[]).map((row) => row.id);
  }

  dismiss(id: string, now: number): boolean {
    return this.db.prepare("INSERT INTO account_warnings (id, dismissed_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").run(id, now).changes > 0;
  }

  keepOnly(active: ReadonlySet<string>, settledAccounts: ReadonlySet<string>): number {
    const stale = this.list().filter((id) => settledAccounts.has(accountOfWarning(id)) && !active.has(id));
    const remove = this.db.prepare("DELETE FROM account_warnings WHERE id = ?");
    this.db.transaction(() => { for (const id of stale) remove.run(id); })();
    return stale.length;
  }
}

export interface AccountsDeps {
  studioPool(): Promise<PoolStatusView | null>;
  bbPool: { available(): boolean; status(): Promise<PoolStatusView> } | null;
  studioSignals(accountIds: readonly string[]): PoolSignals;
  pins(source: "studio" | "bb"): Map<string, PinnedThread[]>;
  providers(): Promise<ProviderState[]>;
  usage?(): Promise<Record<string, QuotaWindow[]>>;
  auth(): Promise<Pick<AuthStatus, "entries">>;
  reorder(provider: string, accountIds: string[]): Promise<void>;
  thread(threadId: string): Promise<{ providerId: string | null; mirrored: boolean } | null>;
  store: WarningStore;
  changed(): void;
  now?(): number;
  timeZone?: string;
}

export class AccountsService {
  private latest: AccountsStatus | null = null;
  private checking: Promise<AccountsStatus> | null = null;
  private providerStates: ProviderState[] = [];

  constructor(private readonly deps: AccountsDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  status(refresh = false): Promise<AccountsStatus> {
    if (!refresh && this.latest && this.now() - this.latest.checkedAt <= FRESH_MS) return Promise.resolve(this.latest);
    this.checking ??= this.check().finally(() => { this.checking = null; });
    return this.checking;
  }

  private async check(): Promise<AccountsStatus> {
    const now = this.now();
    const bb = this.deps.bbPool;
    const [studio, live, providers, auth, usage] = await Promise.all([
      this.deps.studioPool().catch(() => null),
      bb?.available() ? bb.status().then((value) => ({ ok: true as const, value }), () => ({ ok: false as const })) : Promise.resolve(null),
      this.deps.providers().catch(() => [] as ProviderState[]),
      this.deps.auth().catch(() => ({ entries: [] })),
      this.deps.usage ? this.deps.usage().catch(() => null) : Promise.resolve({}),
    ]);
    this.providerStates = providers;
    const sources: SourceStatus[] = [
      { source: "studio", name: "BB Studio", state: studio ? "on" : "off" },
      { source: "bb", name: "bb", state: live === null ? "off" : live.ok ? "on" : "unreachable" },
      { source: "local", name: "This Mac", state: "on" },
    ];
    const accounts: AccountView[] = [];
    if (studio) {
      const signals = this.deps.studioSignals(studio.accounts.map((account) => account.id));
      const pins = this.deps.pins("studio");
      for (const summary of studio.accounts) accounts.push(poolAccountView(summary, "studio", { signals, pins: pins.get(summary.id) ?? [], now }));
    }
    if (live?.ok) {
      const pins = this.deps.pins("bb");
      for (const summary of live.value.accounts) accounts.push(poolAccountView(summary, "bb", { pins: pins.get(summary.id) ?? [], now }));
    }
    const signedOut = new Set(auth.entries.filter((entry) => entry.source === "provider" && entry.signedOut).map((entry) => entry.id.slice("provider:".length)));
    const connected = accounts.some((account) => account.state === "ready" || account.state === "limited") || providers.some((state) => state.status === "ready" && !!state.loginCommand);
    const local = localAccountViews(providers, signedOut, providerFamily, usage ?? {});
    accounts.push(...local);
    const quiet = new Set(connected ? local.filter((account) => account.state === "signed_out" && !signedOut.has(account.id)).map((account) => account.key) : []);
    const all = computeWarnings(accounts.filter((account) => !quiet.has(account.key)), now, this.deps.timeZone);
    const settled = new Set(accounts.filter((account) => sources.find((source) => source.source === account.source)?.state === "on" && (usage !== null || account.source !== "local")).map((account) => account.key));
    this.deps.store.keepOnly(new Set(all.map((warning) => warning.id)), settled);
    const dismissed = this.deps.store.list();
    const hidden = new Set(dismissed);
    const warnings = all.filter((warning) => !hidden.has(warning.id));
    const before = this.latest ? JSON.stringify({ a: this.latest.accounts, w: this.latest.warnings }) : null;
    this.latest = { checkedAt: now, sources, accounts, warnings, dismissed: dismissed.filter((id) => all.some((warning) => warning.id === id)) };
    if (before !== JSON.stringify({ a: accounts, w: warnings })) this.deps.changed();
    return this.latest;
  }

  async dismiss(id: string): Promise<{ dismissed: boolean }> {
    const status = await this.status();
    if (!status.warnings.some((warning) => warning.id === id)) return { dismissed: false };
    const dismissed = this.deps.store.dismiss(id, this.now());
    if (dismissed && this.latest) {
      this.latest = { ...this.latest, warnings: this.latest.warnings.filter((warning) => warning.id !== id), dismissed: [...this.latest.dismissed, id] };
      this.deps.changed();
    }
    return { dismissed };
  }

  async useOther(accountKey: string): Promise<{ accountKey: string | null }> {
    if (!accountKey.startsWith("studio:")) throw new Error("Only BB Studio's own accounts can be reordered here.");
    const status = await this.status(true);
    const account = status.accounts.find((each) => each.key === accountKey);
    if (!account) throw new Error("No such account.");
    const same = status.accounts.filter((each) => each.source === "studio" && each.provider === account.provider);
    const ready = same.filter((each) => each.key !== accountKey && each.state === "ready");
    if (!ready.length) return { accountKey: null };
    const order = [...ready, ...same.filter((each) => !ready.includes(each))];
    await this.deps.reorder(account.provider, order.map((each) => each.id));
    await this.status(true);
    return { accountKey: ready[0]!.key };
  }

  async thread(threadId: string): Promise<ThreadAccount> {
    const [status, thread] = await Promise.all([this.status(), this.deps.thread(threadId).catch(() => null)]);
    if (!thread?.providerId) return null;
    const family = providerFamily(thread.providerId);
    const provider = this.providerStates.find((state) => state.providerId === thread.providerId);
    const pooled = provider ? isProxied(provider) : false;
    if (pooled) {
      const source = thread.mirrored ? "bb" : "studio";
      const accounts = status.accounts.filter((each) => each.source === source && each.provider === family && each.state !== "disabled");
      if (!accounts.length || accounts.some((each) => each.state === "ready" || each.state === "limited")) return null;
      const out = accounts.find((each) => each.state === "signed_out") ?? accounts[0]!;
      return { accountKey: out.key, source, name: out.name, state: out.state, signIn: out.signIn };
    }
    const local = status.accounts.find((each) => each.source === "local" && each.id === thread.providerId);
    if (!local || local.state !== "signed_out") return null;
    return { accountKey: local.key, source: "local", name: local.name, state: local.state, signIn: local.signIn };
  }
}
