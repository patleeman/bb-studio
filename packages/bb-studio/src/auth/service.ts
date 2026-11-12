import { randomUUID } from "node:crypto";
import type { AuthEntry, AuthStatus, LoginSession, PoolAccount, ProviderState } from "./contract";
import { isAuthError, isProxied, poolEntries, providerEntries, resolveTarget } from "./detect";
import { safeMessage, safeSignInUrl, safeUserCode, signInGuide } from "./scrub";

const STATUS_FRESH_MS = 30_000;
const LOCAL_TTL_MS = 15 * 60_000;
const CLAUDE_TTL_MS = 10 * 60_000;
const LOCAL_POLL_MS = 2_000;
const KEEP_FINISHED_MS = 5 * 60_000;
const BUFFER_MAX = 64 * 1024;
const SEEN_READY_KEY = "auth-seen-ready";

export interface AuthPool {
  list(): Promise<PoolAccount[] | null>;
  codexStart(accountId: string): Promise<{ sessionId: string; verificationUri: string; userCode: string; expiresAt: number; intervalMs: number }>;
  codexPoll(sessionId: string): Promise<{ status: "pending" } | { status: "complete" } | { status: "error"; message: string }>;
  codexCancel(sessionId: string): Promise<unknown>;
  claudeStart(accountId: string): Promise<{ sessionId: string; authorizeUrl: string }>;
  claudeComplete(sessionId: string, pasted: string): Promise<unknown>;
}

export interface AuthTerminal {
  create(args: { command: string; title: string }): Promise<{ id: string }>;
  output(id: string, sinceSeq: number): Promise<{ text: string; nextSeq: number }>;
  state(id: string): Promise<{ running: boolean; exitCode: number | null }>;
  input(id: string, text: string): Promise<void>;
  close(id: string): Promise<void>;
}

export interface AuthDeps {
  pool: AuthPool;
  bbPool?: AuthPool | null;
  providers: { states(): Promise<ProviderState[]> };
  terminal: AuthTerminal;
  kv: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  changed(): void;
  log?(message: string): void;
  now?(): number;
  newId?(): string;
}

interface Session {
  view: LoginSession;
  kind: "pool-codex" | "pool-claude" | "local";
  pool: AuthPool;
  entry: AuthEntry;
  poolSessionId: string | null;
  terminalId: string | null;
  seq: number;
  buffer: string;
  submitted: boolean;
  readyAtStart: boolean;
  finishedAt: number | null;
  polling: Promise<LoginSession> | null;
}

export class AuthService {
  private latest: AuthStatus | null = null;
  private checking: Promise<AuthStatus> | null = null;
  private seenReady: Set<string> | null = null;
  private readonly turnErrors = new Map<string, number>();
  private readonly sessions = new Map<string, Session>();
  private recheck: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly deps: AuthDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  async status(refresh = false): Promise<AuthStatus> {
    if (!refresh && this.latest && this.now() - this.latest.checkedAt <= STATUS_FRESH_MS) return this.latest;
    this.checking ??= this.check().finally(() => { this.checking = null; });
    return this.checking;
  }

  private async loadSeenReady(): Promise<Set<string>> {
    if (!this.seenReady) {
      const stored = await this.deps.kv.get(SEEN_READY_KEY).catch(() => null);
      this.seenReady = new Set(Array.isArray(stored) ? stored.filter((each): each is string => typeof each === "string") : []);
    }
    return this.seenReady;
  }

  private async check(): Promise<AuthStatus> {
    const [accounts, states, seenReady] = await Promise.all([
      this.deps.pool.list().catch(() => null),
      this.deps.providers.states().catch(() => [] as ProviderState[]),
      this.loadSeenReady(),
    ]);
    const ready = states.filter((state) => state.status === "ready" && !isProxied(state) && !seenReady.has(state.providerId));
    if (ready.length) {
      for (const state of ready) seenReady.add(state.providerId);
      await this.deps.kv.set(SEEN_READY_KEY, [...seenReady]).catch(() => {});
    }
    const entries = [
      ...poolEntries(accounts ?? []),
      ...providerEntries(states, { seenReady, turnErrors: new Set(this.turnErrors.keys()) }),
    ];
    const before = JSON.stringify(this.latest?.entries ?? null);
    this.latest = { checkedAt: this.now(), pool: accounts ? "on" : "off", entries };
    if (before !== JSON.stringify(entries)) this.deps.changed();
    return this.latest;
  }

  private checkSoon(): void {
    if (this.recheck || this.disposed) return;
    this.recheck = setTimeout(() => {
      this.recheck = null;
      void this.status(true).catch(() => {});
    }, 1_000);
  }

  noteTurn(providerId: string | null | undefined, outcome: "failed" | "ok", error?: string | null): void {
    if (!providerId) return;
    if (outcome === "failed") {
      if (!isAuthError(error)) return;
      this.turnErrors.set(providerId, this.now());
      this.checkSoon();
    } else if (this.turnErrors.delete(providerId)) {
      this.checkSoon();
    }
  }

  private prune(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.finishedAt !== null && now - session.finishedAt > KEEP_FINISHED_MS) this.sessions.delete(id);
    }
  }

  private open(entry: AuthEntry, kind: Session["kind"], view: Omit<LoginSession, "sessionId" | "targetId" | "name">): Session {
    const session: Session = {
      view: { sessionId: (this.deps.newId ?? randomUUID)(), targetId: entry.id, name: entry.name, ...view },
      kind, pool: entry.source === "bb" && this.deps.bbPool ? this.deps.bbPool : this.deps.pool, entry, poolSessionId: null, terminalId: null, seq: 0, buffer: "", submitted: false, readyAtStart: false, finishedAt: null, polling: null,
    };
    this.sessions.set(session.view.sessionId, session);
    return session;
  }

  private async finish(session: Session, state: "saved" | "failed" | "expired", message: string | null): Promise<void> {
    if (session.finishedAt !== null) return;
    session.finishedAt = this.now();
    session.view = { ...session.view, state, message };
    if (session.terminalId) await this.deps.terminal.close(session.terminalId).catch(() => {});
    if (state === "saved") {
      if (session.entry.source === "provider") {
        const providerId = session.entry.id.slice("provider:".length);
        this.turnErrors.delete(providerId);
        const seen = await this.loadSeenReady();
        if (!seen.has(providerId)) {
          seen.add(providerId);
          await this.deps.kv.set(SEEN_READY_KEY, [...seen]).catch(() => {});
        }
      }
      await this.status(true).catch(() => {});
    }
    this.deps.log?.(`Sign-in ${state}: ${session.entry.id}`);
    this.deps.changed();
  }

  private async bbEntry(target: string): Promise<AuthEntry> {
    const accountId = target.slice("bb:".length);
    if (!this.deps.bbPool) throw new Error("bb is not running on this Mac.");
    const account = (await this.deps.bbPool.list())?.find((each) => each.id === accountId);
    if (!account || account.kind !== "oauth") throw new Error(`No bb Account Pooler account ${accountId}.`);
    const name = account.provider === "codex" ? "Codex" : "Claude";
    const email = account.email && account.email !== account.label ? account.email : null;
    return { id: target, source: "bb", provider: account.provider, name: `${name} in bb`, detail: ["bb", account.label, email].filter(Boolean).join(" · "), signedOut: true, reason: null };
  }

  async start(target: string): Promise<LoginSession> {
    this.prune();
    let entry: AuthEntry;
    if (target.startsWith("bb:")) entry = await this.bbEntry(target);
    else {
      const status = await this.status(true);
      const resolved = resolveTarget(status.entries, target);
      if (!resolved.ok) throw new Error(resolved.error);
      entry = resolved.entry;
    }
    const active = [...this.sessions.values()].find((session) => session.entry.id === entry.id && session.finishedAt === null);
    if (active) return this.poll(active.view.sessionId);
    this.deps.log?.(`Sign-in started: ${entry.id}`);
    const base = { acceptsCode: false, message: null, state: "waiting" as const };
    if (entry.source === "pool" || entry.source === "bb") {
      const accountId = entry.id.slice(entry.id.indexOf(":") + 1);
      const pool = entry.source === "bb" && this.deps.bbPool ? this.deps.bbPool : this.deps.pool;
      if (entry.provider === "codex") {
        const started = await pool.codexStart(accountId);
        const url = safeSignInUrl(started.verificationUri);
        const code = safeUserCode(started.userCode);
        if (!url || !code) {
          await pool.codexCancel(started.sessionId).catch(() => {});
          throw new Error("The sign-in service returned no usable code.");
        }
        const session = this.open(entry, "pool-codex", { ...base, flow: "device", url, code, expiresAt: started.expiresAt, pollMs: Math.max(1_000, started.intervalMs) });
        session.poolSessionId = started.sessionId;
        return session.view;
      }
      const started = await pool.claudeStart(accountId);
      const url = safeSignInUrl(started.authorizeUrl);
      if (!url) throw new Error("The sign-in service returned no usable link.");
      const session = this.open(entry, "pool-claude", { ...base, flow: "browser", url, code: null, acceptsCode: true, expiresAt: this.now() + CLAUDE_TTL_MS, pollMs: LOCAL_POLL_MS });
      session.poolSessionId = started.sessionId;
      return session.view;
    }
    const providerId = entry.id.slice("provider:".length);
    const state = (await this.deps.providers.states()).find((each) => each.providerId === providerId);
    if (!state?.loginCommand) throw new Error(`${entry.name} has no sign-in command.`);
    const session = this.open(entry, "local", { ...base, state: "starting", flow: "browser", url: null, code: null, expiresAt: this.now() + LOCAL_TTL_MS, pollMs: LOCAL_POLL_MS });
    session.readyAtStart = state.status === "ready";
    try {
      session.terminalId = (await this.deps.terminal.create({ command: state.loginCommand, title: `Sign in: ${entry.name}` })).id;
    } catch (error) {
      await this.finish(session, "failed", safeMessage(error instanceof Error ? error.message : null, "The sign-in command did not start."));
    }
    return session.view;
  }

  private session(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Sign-in session not found. Start again.");
    return session;
  }

  poll(sessionId: string): Promise<LoginSession> {
    const session = this.session(sessionId);
    if (session.finishedAt !== null) return Promise.resolve(session.view);
    session.polling ??= this.advance(session).finally(() => { session.polling = null; });
    return session.polling;
  }

  private async advance(session: Session): Promise<LoginSession> {
    const expired = session.view.expiresAt !== null && this.now() >= session.view.expiresAt;
    if (session.kind === "pool-codex") {
      const result = await session.pool.codexPoll(session.poolSessionId!).catch((error: unknown) => ({ status: "error" as const, message: error instanceof Error ? error.message : "" }));
      if (result.status === "complete") await this.finish(session, "saved", null);
      else if (result.status === "error") {
        const message = safeMessage(result.message, "Sign-in failed.");
        await this.finish(session, /expired/i.test(message) ? "expired" : "failed", message);
      } else if (expired) {
        await session.pool.codexCancel(session.poolSessionId!).catch(() => {});
        await this.finish(session, "expired", "Code expired.");
      }
      return session.view;
    }
    if (session.kind === "pool-claude") {
      if (expired) await this.finish(session, "expired", "Link expired.");
      return session.view;
    }
    const terminalId = session.terminalId!;
    const output = await this.deps.terminal.output(terminalId, session.seq).catch(() => null);
    if (output) {
      session.seq = output.nextSeq;
      if (!session.submitted) {
        session.buffer = (session.buffer + output.text).slice(-BUFFER_MAX);
        const guide = signInGuide(session.buffer);
        if (guide.url) {
          session.view = { ...session.view, url: guide.url, code: guide.code, acceptsCode: guide.acceptsCode, flow: guide.code ? "device" : "browser", state: "waiting" };
        }
      }
    }
    const terminal = await this.deps.terminal.state(terminalId).catch(() => ({ running: true, exitCode: null }));
    if (!terminal.running) {
      session.buffer = "";
      if (terminal.exitCode === 0) await this.finish(session, "saved", null);
      else await this.finish(session, "failed", terminal.exitCode === null ? "The sign-in command stopped." : `The sign-in command exited with code ${terminal.exitCode}.`);
      return session.view;
    }
    if (!session.readyAtStart) {
      const providerId = session.entry.id.slice("provider:".length);
      const state = (await this.deps.providers.states().catch(() => [] as ProviderState[])).find((each) => each.providerId === providerId);
      if (state?.status === "ready" && !isProxied(state)) {
        session.buffer = "";
        await this.finish(session, "saved", null);
        return session.view;
      }
    }
    if (expired) {
      session.buffer = "";
      await this.finish(session, "expired", "Sign-in timed out.");
    }
    return session.view;
  }

  async complete(sessionId: string, code: string): Promise<LoginSession> {
    const session = this.session(sessionId);
    if (session.finishedAt !== null) return session.view;
    if (!session.view.acceptsCode) throw new Error("This sign-in takes no pasted code.");
    const pasted = code.trim();
    if (session.kind === "pool-claude") {
      try {
        await session.pool.claudeComplete(session.poolSessionId!, pasted);
        await this.finish(session, "saved", null);
      } catch (error) {
        await this.finish(session, "failed", safeMessage(error instanceof Error ? error.message : null, "Sign-in failed."));
      }
      return session.view;
    }
    if (session.kind !== "local" || !session.terminalId) throw new Error("This sign-in takes no pasted code.");
    session.submitted = true;
    session.buffer = "";
    await this.deps.terminal.input(session.terminalId, `${pasted}\r`);
    return session.view;
  }

  async cancel(sessionId: string): Promise<{ cancelled: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { cancelled: false };
    this.sessions.delete(sessionId);
    if (session.finishedAt !== null) return { cancelled: false };
    session.finishedAt = this.now();
    session.buffer = "";
    if (session.kind === "pool-codex") await session.pool.codexCancel(session.poolSessionId!).catch(() => {});
    if (session.terminalId) await this.deps.terminal.close(session.terminalId).catch(() => {});
    this.deps.log?.(`Sign-in cancelled: ${session.entry.id}`);
    return { cancelled: true };
  }

  async sweep(): Promise<void> {
    this.prune();
    await Promise.all([...this.sessions.values()].filter((session) => session.finishedAt === null).map((session) => this.poll(session.view.sessionId).catch(() => {})));
    await this.status(true).catch(() => {});
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.recheck) clearTimeout(this.recheck);
    this.recheck = null;
    await Promise.all([...this.sessions.keys()].map((id) => this.cancel(id).catch(() => {})));
  }
}
