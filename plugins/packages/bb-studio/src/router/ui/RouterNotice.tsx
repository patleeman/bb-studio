// The usage-limit notice above a thread's composer (a composer banner). Hand
// off picks the suggested model in this composer's own picker, which starts
// BB's handoff (the draft gets "Continue from @thread:…"), and sends it: BB
// makes the new thread and opens it. The old thread stays as it is, except
// that its queued retry is cancelled so it doesn't start again on its own.
import { useComposer, useRealtime, useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../kit/ui/index";
import { ROUTER_CHANNEL, type Notice, type routerContract } from "../contract";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function RouterNoticeBanner() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const rpc = useRpc<typeof routerContract>();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!threadId) {
      setNotice(null);
      return;
    }
    void rpc.call("router.notice.get", { threadId }).then(setNotice, () => setNotice(null));
  }, [rpc, threadId]);
  useEffect(refresh, [refresh]);
  useRealtime(ROUTER_CHANNEL, (payload) => {
    const changed = (payload as { threadId?: unknown } | null)?.threadId;
    if (changed === undefined || changed === threadId) refresh();
  });

  if (!threadId || !notice) return null;
  const target = notice.target;

  const handOff = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selection = await composer.setSelection({
        providerId: target.providerId,
        model: target.model,
        ...(target.reasoningLevel ? { reasoningLevel: target.reasoningLevel } : {}),
      });
      if (selection.providerId !== target.providerId || selection.model !== target.model) {
        throw new Error(`${notice.targetName ?? target.model} isn't in this composer's model picker.`);
      }
      await composer.submit();
      void rpc.call("router.handedOff", { threadId }).catch(() => undefined);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    void rpc.call("router.notice.dismiss", { threadId }).then(() => setNotice(null), (cause) => setError(errorText(cause)));
  };

  return (
    <div data-testid="router-notice" role="status" className="studio-root flex flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-foreground">{notice.text}</p>
        {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {target ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => void handOff()} data-testid="router-hand-off">
            {busy ? "Handing off…" : "Hand off"}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function registerRouterNotice(app: PluginAppBuilder): void {
  app.composer.customize({ id: "router-notice", scopes: ["thread"], banners: [{ id: "router-notice", component: RouterNoticeBanner }] });
}
