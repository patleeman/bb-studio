import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { GHOST_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from "../../kit/app/index";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Icon, Input } from "../../kit/ui/index";
import { errorMessage } from "../../kit/format";
import { useCall } from "../../ui/live";
import type { LoginSession } from "../contract";
import { closeRelogin, useReloginTarget, type ReloginTarget } from "./relogin-store";

export interface ReloginApi {
  start(target: string): Promise<LoginSession>;
  poll(sessionId: string): Promise<LoginSession>;
  complete(sessionId: string, code: string): Promise<LoginSession>;
  cancel(sessionId: string): Promise<unknown>;
}

export interface ReloginEnv {
  openUrl(url: string): void;
  copy(text: string): Promise<void>;
  saved(name: string): void;
  closeDelayMs: number;
}

const defaultEnv: ReloginEnv = {
  openUrl: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
  copy: (text) => navigator.clipboard.writeText(text),
  saved: (name) => { toast.success(`${name} signed in`); },
  closeDelayMs: 1200,
};

const open = (session: LoginSession | null) => !!session && (session.state === "starting" || session.state === "waiting");

const STATUS: Record<LoginSession["state"], string> = {
  starting: "Starting",
  waiting: "Waiting for sign-in",
  saved: "Signed in",
  failed: "Sign-in failed",
  expired: "Code expired",
};

export function statusText(session: LoginSession | null, error: string | null): string {
  if (error) return error;
  if (!session) return STATUS.starting;
  if (session.state === "failed" || session.state === "expired") return session.message ?? STATUS[session.state];
  return STATUS[session.state];
}

export function ReloginFlow({ target, api, onClose, env = defaultEnv, compact = false }: { target: ReloginTarget; api: ReloginApi; onClose(): void; env?: ReloginEnv; compact?: boolean }) {
  const [session, setSession] = useState<LoginSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const live = useRef<LoginSession | null>(null);
  const opened = useRef<string | null>(null);
  const mounted = useRef(true);
  live.current = session;

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setError(null);
    setCopied(false);
    setPasted("");
    api.start(target.id).then((next) => {
      if (!cancelled) setSession(next);
      else if (!mounted.current && open(next)) void api.cancel(next.sessionId).catch(() => {});
    }, (cause: unknown) => { if (!cancelled) setError(errorMessage(cause)); });
    return () => { cancelled = true; };
  }, [api, target.id, attempt]);

  const sessionId = session?.sessionId ?? null;
  const polling = open(session);
  const pollMs = session?.pollMs ?? 2000;
  useEffect(() => {
    if (!sessionId || !polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        api.poll(sessionId).then((next) => { if (!stopped) { setSession(next); if (open(next)) tick(); } }, () => { if (!stopped) tick(); });
      }, pollMs);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, sessionId, polling, pollMs]);

  const saved = session?.state === "saved";
  useEffect(() => {
    if (!saved) return;
    env.saved(target.name);
    const timer = setTimeout(onClose, env.closeDelayMs);
    return () => clearTimeout(timer);
  }, [saved, env, onClose, target.name]);

  const url = session?.url ?? null;
  const autoOpen = !!url && session?.flow === "browser" && session.state === "waiting" && (target.id.startsWith("pool:") || target.id.startsWith("bb:"));
  useEffect(() => {
    if (!autoOpen || !url || opened.current === sessionId) return;
    opened.current = sessionId;
    env.openUrl(url);
  }, [autoOpen, url, sessionId, env]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const last = live.current;
      if (last && open(last)) void api.cancel(last.sessionId).catch(() => {});
    };
  }, [api]);

  const copy = useCallback((text: string) => {
    void env.copy(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => {});
  }, [env]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = pasted.trim();
    if (!session || !code || sending) return;
    setSending(true);
    api.complete(session.sessionId, code).then((next) => { setSession(next); setPasted(""); }, (cause: unknown) => setError(errorMessage(cause))).finally(() => setSending(false));
  };

  const state = error ? "failed" : session?.state ?? "starting";
  const waiting = session?.state === "waiting";
  const over = state === "failed" || state === "expired";
  return (
    <div data-testid="relogin" data-auth-state={state} className={`flex flex-col ${compact ? "gap-2" : "gap-4"}`}>
      {waiting && session.code ? (
        <output data-testid="relogin-code" aria-label="Code" className={`select-all rounded-md border border-border bg-foreground/[0.04] text-center font-mono font-semibold tracking-widest ${compact ? "py-2 text-xl" : "py-3 text-2xl"}`}>{session.code}</output>
      ) : null}
      {waiting && url ? <a data-testid="relogin-url" href={url} target="_blank" rel="noopener noreferrer" className="truncate text-center text-sm text-muted-foreground underline-offset-2 hover:underline" title={url} onClick={(event) => { event.preventDefault(); env.openUrl(url); }}>{url}</a> : null}
      {waiting && url ? (
        <div className="flex flex-wrap justify-center gap-2">
          {session.code
            ? <button type="button" className={OUTLINE_BUTTON} data-testid="relogin-copy" onClick={() => copy(session.code!)}><Icon name={copied ? "Check" : "Copy"} />{copied ? "Copied" : "Copy code"}</button>
            : <button type="button" className={OUTLINE_BUTTON} data-testid="relogin-copy" onClick={() => copy(url)}><Icon name={copied ? "Check" : "Copy"} />{copied ? "Copied" : "Copy link"}</button>}
          <button type="button" className={PRIMARY_BUTTON} data-testid="relogin-open" onClick={() => env.openUrl(url)}><Icon name="ExternalLink" />Open browser</button>
        </div>
      ) : null}
      {waiting && session.acceptsCode ? (
        <form className="flex gap-2" onSubmit={submit} data-testid="relogin-paste">
          <Input aria-label="Code" placeholder="Code" autoComplete="off" spellCheck={false} type="password" value={pasted} onChange={(event) => setPasted(event.target.value)} className="min-w-0 flex-1 font-mono" />
          <button type="submit" className={OUTLINE_BUTTON} disabled={!pasted.trim() || sending}>Submit</button>
        </form>
      ) : null}
      <p role="status" data-testid="relogin-status" className={`flex items-center justify-center gap-2 text-sm ${over ? "text-destructive" : saved ? "text-success" : "text-muted-foreground"}`}>
        {saved ? <Icon name="Check" className="size-4" /> : over ? null : <span aria-hidden className="size-2 animate-pulse rounded-full bg-current motion-reduce:animate-none" />}
        {statusText(session, error)}
      </p>
      {over ? (
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST_BUTTON} onClick={onClose}>Close</button>
          <button type="button" className={PRIMARY_BUTTON} data-testid="relogin-retry" onClick={() => setAttempt((count) => count + 1)}>Try again</button>
        </div>
      ) : null}
    </div>
  );
}

export function ReloginDialog({ target, api, onClose, env = defaultEnv }: { target: ReloginTarget; api: ReloginApi; onClose(): void; env?: ReloginEnv }) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-sm" data-testid="relogin-dialog">
        <DialogHeader>
          <DialogTitle>Sign in to {target.name}</DialogTitle>
          {target.detail ? <DialogDescription className="text-sm text-muted-foreground">{target.detail}</DialogDescription> : null}
        </DialogHeader>
        <ReloginFlow target={target} api={api} onClose={onClose} env={env} />
      </DialogContent>
    </Dialog>
  );
}

export function useReloginApi(): ReloginApi {
  const call = useCall();
  const api = useRef<ReloginApi | null>(null);
  api.current ??= {
    start: (id) => call("auth.login.start", { target: id }),
    poll: (sessionId) => call("auth.login.poll", { sessionId }),
    complete: (sessionId, code) => call("auth.login.complete", { sessionId, code }),
    cancel: (sessionId) => call("auth.login.cancel", { sessionId }),
  };
  return api.current;
}

export function ReloginHost() {
  const target = useReloginTarget();
  const api = useReloginApi();
  if (!target) return null;
  return <ReloginDialog key={target.id} target={target} api={api} onClose={closeRelogin} />;
}
