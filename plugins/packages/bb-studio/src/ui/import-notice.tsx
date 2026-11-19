// When BB Studio's first start could not copy the bb install (too slow, or an
// error), the server starts clean and says why in GET /api/v1/fork/import
// (`failure.message`). This shows that message once, as a banner on the
// Bot's first chat, until dismissed. On a BB without the import routes, or
// with nothing failed, the request answers nothing and nothing is drawn.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { GHOST_BUTTON } from "../kit/app/index";
import { registerThreadBanner } from "../kit/app/host-sdk";
import { useLive } from "./live";

export interface ImportFailure {
  message: string;
  failedAt: number;
}

const DISMISSED_KEY = "studio.importNotice.dismissedAt";

/** The failure in a GET /api/v1/fork/import answer, or null when there is none. */
export function importFailureFrom(body: unknown): ImportFailure | null {
  if (typeof body !== "object" || body === null) return null;
  const { imported, failure } = body as { imported?: unknown; failure?: unknown };
  if (imported === true || typeof failure !== "object" || failure === null) return null;
  const { message, failedAt } = failure as { message?: unknown; failedAt?: unknown };
  if (typeof message !== "string" || message.trim().length === 0) return null;
  return { message, failedAt: typeof failedAt === "number" ? failedAt : 0 };
}

let request: Promise<ImportFailure | null> | null = null;

/** Asks once per session. */
export function readImportFailure(load: typeof fetch = fetch): Promise<ImportFailure | null> {
  request ??= load("/api/v1/fork/import")
    .then(async (response) => (response.ok ? importFailureFrom(await response.json()) : null))
    .catch(() => null);
  return request;
}

export function resetImportFailureForTests(): void {
  request = null;
}

const storage = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

function dismissed(failure: ImportFailure): boolean {
  return Number(storage()?.getItem(DISMISSED_KEY) ?? Number.NaN) === failure.failedAt;
}

export function ImportNoticeBanner({ threadId }: { threadId: string }) {
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  useEffect(() => {
    let current = true;
    void readImportFailure().then((next) => { if (current) setFailure(next); });
    return () => { current = false; };
  }, []);
  return failure && !dismissed(failure) ? <FirstChatNotice threadId={threadId} failure={failure} /> : null;
}

function FirstChatNotice({ threadId, failure }: { threadId: string; failure: ImportFailure }) {
  const welcome = useLive("bot_welcome", {});
  const [hidden, setHidden] = useState(false);
  if (hidden || welcome.data?.threadId !== threadId) return null;
  return <ImportNoticeView message={failure.message} onDismiss={() => { storage()?.setItem(DISMISSED_KEY, String(failure.failedAt)); setHidden(true); }} />;
}

export function ImportNoticeView({ message, onDismiss }: { message: string; onDismiss(): void }) {
  return (
    <div data-testid="import-notice" role="status" className="studio-root flex shrink-0 items-center gap-2 px-5 py-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" className={GHOST_BUTTON} onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

/** Under the first chat's header; nothing on a BB without thread banners. */
export function registerImportNotice(app: PluginAppBuilder): void {
  registerThreadBanner(app.slots, { id: "import-notice", component: ImportNoticeBanner });
}
