// A mini app's frame, and the host that relays between it and Studio.
//
// The frame (src/minis/server/frame.ts) runs in an opaque origin with no
// network. Everything it does goes through postMessage to this component:
// only messages from this frame's own window are read, and the server checks
// every call (collections, capabilities, rate limits) again. A take the app
// sends becomes a mention in the thread's composer, so the user sees it
// before anything reaches the agent.
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { openAppPath } from "../../kit/app/index";
import { composerFor } from "../../kit/composer";
import { errorMessage } from "../../kit/format";
import type { rpcContract } from "../contract";
import { frameUrl, MINI_MESSAGE, REALTIME_CHANNEL, THEME_COLORS, type MiniEvent } from "../shared";

const HEARTBEAT = 20_000;
const TOUCH_EVERY = 2_000;

type FrameMessage =
  | { op: "ready" }
  | { op: "call"; id: number; method: string; params: Record<string, unknown> }
  | { op: "save"; state: unknown }
  | { op: "emit"; name: string; data: unknown }
  | { op: "expose"; actions: string[] }
  | { op: "send"; label: string; data: unknown }
  | { op: "result"; id: string; ok: boolean; value?: unknown; error?: string }
  | { op: "touch" }
  | { op: "size"; height: number }
  | { op: "error"; message: string };

export function useDarkMode(): boolean {
  const read = () => document.documentElement.classList.contains("dark") || document.body.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** BB's colors as the frame should use them, resolved here so the frame needs none of BB's CSS. */
function themeTokens(): Record<string, string> {
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.append(probe);
  const tokens: Record<string, string> = {};
  for (const name of THEME_COLORS) {
    probe.style.color = "";
    probe.style.color = `var(--${name})`;
    const value = getComputedStyle(probe).color;
    if (value && getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()) tokens[`--${name}`] = value;
  }
  probe.remove();
  const font = getComputedStyle(document.body).fontFamily;
  if (font) tokens["--ui-font"] = font;
  return tokens;
}

/** Thread ids, Studio links and app paths `playground.bb.open` may go to. */
function openTarget(target: string, navigate: ReturnType<typeof useBbNavigate>) {
  if (/^thr_[a-zA-Z0-9]+$/.test(target)) return navigate.toThread(target);
  if (/^\/(?:plugins|threads|projects)\//.test(target)) return openAppPath(target);
  throw new Error("bb.open takes a thread id or a BB path such as /plugins/studio/studio/pages/<id>.");
}

export function MiniFrame({
  miniId,
  versionId,
  name,
  threadId,
  fit = false,
  minHeight = 120,
  maxHeight = 720,
  onError,
}: {
  miniId: string;
  versionId: string;
  name: string;
  threadId: string | null;
  /** Height follows the app's, between min and max, as in a page block or chat card; otherwise it fills its box. */
  fit?: boolean;
  minHeight?: number;
  maxHeight?: number;
  onError?(message: string | null): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const [clientId] = useState(() => crypto.randomUUID());
  const dark = useDarkMode();
  const [height, setHeight] = useState<number | null>(null);
  // The theme the frame loads with; later changes are posted to it.
  const [initialTheme] = useState<"light" | "dark">(dark ? "dark" : "light");
  const actions = useRef<string[] | null>(null);
  const touched = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ type: MINI_MESSAGE, ...message }, "*");

  useEffect(() => post({ op: "theme", theme: dark ? "dark" : "light", tokens: themeTokens() }), [dark]);

  useEffect(() => {
    const report = (error: unknown) => console.warn("[studio] mini app:", errorMessage(error));
    const id = miniId;

    async function answer(method: string, params: Record<string, unknown>): Promise<unknown> {
      const collection = String(params.collection ?? "");
      switch (method) {
        case "db.find":
          return (await rpc.call("minis.db.find", { id, collection, query: (params.query ?? {}) as never })).records;
        case "db.count":
          return (await rpc.call("minis.db.count", { id, collection, query: { where: ((params.query as { where?: unknown } | undefined)?.where ?? undefined) as never } })).count;
        case "db.get":
          return (await rpc.call("minis.db.get", { id, collection, recordId: String(params.id) })).record;
        case "db.insert":
          return (await rpc.call("minis.db.insert", { id, clientId, collection, data: (params.data ?? {}) as never, ...(params.id ? { recordId: String(params.id) } : {}) })).record;
        case "db.update":
          return (await rpc.call("minis.db.update", { id, clientId, collection, recordId: String(params.id), data: (params.data ?? {}) as never, ...(typeof params.rev === "number" ? { rev: params.rev } : {}) })).record;
        case "db.patch":
          return (await rpc.call("minis.db.patch", { id, clientId, collection, recordId: String(params.id), fields: (params.fields ?? {}) as never })).record;
        case "db.remove":
          return rpc.call("minis.db.remove", { id, clientId, collection, recordId: String(params.id) });
        case "fetch":
          return rpc.call("minis.fetch", {
            id,
            url: String(params.url),
            method: String(params.method ?? "GET"),
            headers: (params.headers ?? {}) as Record<string, string>,
            body: typeof params.body === "string" ? params.body : null,
            auth: typeof params.auth === "string" ? params.auth : null,
          });
        case "bb.threads.list":
          return (await rpc.call("minis.bb.threads", { id, ...(typeof params.limit === "number" ? { limit: params.limit } : {}) })).threads;
        case "bb.studio.list":
          return (await rpc.call("minis.bb.studio", { id, ...(params as { query?: string; kind?: string; limit?: number }) })).items;
        case "bb.open":
          await rpc.call("minis.bb.canOpen", { id });
          openTarget(String(params.target), navigate);
          return null;
        default:
          throw new Error(`Unknown call ${method}.`);
      }
    }

    async function sendTake(label: string, data: unknown) {
      const composer = threadId ? composerFor(threadId) : null;
      if (!composer) {
        toast.error("Open this mini app's thread to send it to the agent.");
        return;
      }
      try {
        const { takeId } = await rpc.call("minis.live.take", { id, label: label || "Take", data: data ?? null });
        composer.insert({ provider: "mini", id: `${id}/take/${takeId}`, label: label || "Take" }, { at: "end" });
        composer.focus();
      } catch (error) {
        toast.error(`Couldn't send it: ${errorMessage(error)}`);
      }
    }

    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = event.data as ({ type?: unknown } & FrameMessage) | null;
      if (message?.type !== MINI_MESSAGE) return;
      switch (message.op) {
        case "ready":
          onErrorRef.current?.(null);
          post({ op: "theme", theme: document.documentElement.classList.contains("dark") ? "dark" : "light", tokens: themeTokens() });
          break;
        case "call":
          answer(message.method, message.params ?? {}).then(
            (value) => post({ op: "reply", id: message.id, ok: true, value: value ?? null }),
            (error) => post({ op: "reply", id: message.id, ok: false, error: errorMessage(error) }),
          );
          break;
        case "save":
          rpc.call("minis.live.save", { id, clientId, state: message.state ?? null }).catch((error) => toast.error(`Couldn't save: ${errorMessage(error)}`));
          break;
        case "emit":
          rpc.call("minis.live.emit", { id, name: message.name, data: message.data ?? null }).catch(report);
          break;
        case "expose":
          actions.current = message.actions.slice(0, 100);
          rpc.call("minis.live.open", { id, clientId, actions: actions.current }).catch(report);
          break;
        case "touch": {
          const now = Date.now();
          if (now - touched.current < TOUCH_EVERY) break;
          touched.current = now;
          rpc.call("minis.live.touch", { id, clientId }).catch(report);
          break;
        }
        case "result":
          rpc.call("minis.live.result", message.ok ? { commandId: message.id, clientId, ok: true, value: message.value ?? null } : { commandId: message.id, clientId, ok: false, error: String(message.error ?? "The action failed.").slice(0, 2000) }).catch(report);
          break;
        case "size":
          if (typeof message.height === "number" && Number.isFinite(message.height)) setHeight(Math.round(message.height));
          break;
        case "send":
          void sendTake(message.label, message.data);
          break;
        case "error":
          onErrorRef.current?.(String(message.message));
          break;
      }
    };
    window.addEventListener("message", onMessage);
    // Open copies count for approvals and agent actions, whether or not they expose any.
    rpc.call("minis.live.open", { id, clientId, actions: [] }).catch(report);
    const heartbeat = setInterval(() => rpc.call("minis.live.open", { id, clientId, actions: actions.current ?? [] }).catch(report), HEARTBEAT);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(heartbeat);
      rpc.call("minis.live.close", { id, clientId }).catch(() => undefined);
    };
  }, [rpc, miniId, clientId, threadId, navigate]);

  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as MiniEvent | null;
    if (!event || event.miniId !== miniId) return;
    if (event.type === "state" && event.origin !== clientId) post({ op: "state", state: event.state });
    if (event.type === "records") post({ op: "records", collection: event.collection, changes: event.changes });
    if (event.type === "do" && event.clientId === clientId) post({ op: "do", id: event.commandId, action: event.action, args: event.args });
  });

  const fitted = height === null ? Math.max(minHeight, 240) : Math.min(maxHeight, Math.max(minHeight, height));
  return (
    <iframe
      ref={frame}
      title={name}
      src={frameUrl(miniId, versionId, initialTheme)}
      sandbox="allow-scripts allow-forms allow-modals allow-downloads"
      referrerPolicy="no-referrer"
      data-mini-frame={miniId}
      style={{ colorScheme: dark ? "dark" : "light", ...(fit ? { height: fitted } : {}) }}
      className={fit ? "block w-full border-0 bg-transparent" : "size-full border-0 bg-transparent"}
    />
  );
}
