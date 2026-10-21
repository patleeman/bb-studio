// An HTML artifact's preview, live: its page gets `window.playground`
// (src/artifacts/live/shim.ts) and this frame relays between it and Studio.
// Only messages from this frame's own window are read. A take the page sends
// becomes an @artifact mention in the thread's composer, so the user sees it
// before anything reaches the agent.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { composerFor } from "../../kit/composer";
import { errorMessage } from "../../kit/format";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { liveContract } from "../live/contract";
import type { LiveEventPayload } from "../live/server";
import { LIVE_CHANNEL, LIVE_MESSAGE, contentUrl, takeMentionId } from "../shared";

function useDarkMode(): boolean {
  const read = () => document.documentElement.classList.contains("dark") || document.body.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** How often an open copy that exposes actions says it's still open. */
const HEARTBEAT = 20_000;
const TOUCH_EVERY = 2_000;

type FrameMessage =
  | { op: "save"; state: unknown }
  | { op: "emit"; name: string; data: unknown }
  | { op: "expose"; actions: string[] }
  | { op: "send"; label: string; data: unknown }
  | { op: "result"; id: string; ok: boolean; value?: unknown; error?: string }
  | { op: "touch" }
  | { op: "size"; height: number };

/** A fitted chat card stays within these heights; past the most, the page scrolls. */
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 640;

export function LiveHtmlFrame({
  artifactId,
  versionId,
  name,
  threadId,
  fit = false,
}: {
  artifactId: string;
  versionId: string;
  name: string;
  threadId: string | null;
  /** Height follows the page's, as in a chat card; otherwise it fills its box. */
  fit?: boolean;
}) {
  const [height, setHeight] = useState<number | null>(null);
  const rpc = useRpc<typeof liveContract>();
  const frame = useRef<HTMLIFrameElement>(null);
  const [clientId] = useState(() => crypto.randomUUID());
  const dark = useDarkMode();
  // The theme the page loads with; later changes are posted to it.
  const [initialTheme] = useState<"light" | "dark">(dark ? "dark" : "light");
  const actions = useRef<string[] | null>(null);
  const touched = useRef(0);

  const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ type: LIVE_MESSAGE, ...message }, "*");

  useEffect(() => post({ op: "theme", theme: dark ? "dark" : "light" }), [dark]);

  useEffect(() => {
    const report = (error: unknown) => console.warn("[studio] live artifact:", errorMessage(error));
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = event.data as ({ type?: unknown } & FrameMessage) | null;
      if (message?.type !== LIVE_MESSAGE) return;
      switch (message.op) {
        case "save":
          rpc.call("artifacts.live.save", { id: artifactId, clientId, state: message.state }).catch((error) => toast.error(`Couldn't save: ${errorMessage(error)}`));
          break;
        case "emit":
          rpc.call("artifacts.live.emit", { id: artifactId, name: message.name, data: message.data }).catch(report);
          break;
        case "expose":
          actions.current = message.actions.slice(0, 100);
          rpc.call("artifacts.live.open", { id: artifactId, clientId, actions: actions.current }).catch(report);
          break;
        case "touch": {
          const now = Date.now();
          if (now - touched.current < TOUCH_EVERY) break;
          touched.current = now;
          rpc.call("artifacts.live.touch", { id: artifactId, clientId }).catch(report);
          break;
        }
        case "result":
          // RPC input must be JSON: no undefined fields.
          rpc.call("artifacts.live.result", message.ok ? { commandId: message.id, clientId, ok: true, value: message.value ?? null } : { commandId: message.id, clientId, ok: false, error: String(message.error ?? "The action failed.").slice(0, 2000) }).catch(report);
          break;
        case "size":
          if (typeof message.height === "number" && Number.isFinite(message.height)) setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(message.height))));
          break;
        case "send":
          void sendTake(message.label, message.data);
          break;
      }
    };
    async function sendTake(label: string, data: unknown) {
      const composer = threadId ? composerFor(threadId) : null;
      if (!composer) {
        toast.error("Open this artifact's thread to send it to the agent.");
        return;
      }
      try {
        const { takeId } = await rpc.call("artifacts.live.take", { id: artifactId, label: label || "Take", data });
        composer.insert({ provider: "artifact", id: takeMentionId(artifactId, takeId), label: label || "Take" }, { at: "end" });
        composer.focus();
      } catch (error) {
        toast.error(`Couldn't send it: ${errorMessage(error)}`);
      }
    }
    window.addEventListener("message", onMessage);
    const heartbeat = setInterval(() => {
      if (actions.current) rpc.call("artifacts.live.open", { id: artifactId, clientId, actions: actions.current }).catch(report);
    }, HEARTBEAT);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(heartbeat);
      rpc.call("artifacts.live.close", { id: artifactId, clientId }).catch(() => undefined);
    };
  }, [rpc, artifactId, clientId, threadId]);

  useRealtime(LIVE_CHANNEL, (payload) => {
    const event = payload as LiveEventPayload | null;
    if (event?.artifactId !== artifactId) return;
    if (event.type === "state" && event.origin !== clientId) post({ op: "state", state: event.state });
    if (event.type === "do" && event.clientId === clientId) post({ op: "do", id: event.commandId, action: event.action, args: event.args });
  });

  return (
    <iframe
      ref={frame}
      title={name}
      src={contentUrl(artifactId, versionId, { quote: true, live: initialTheme })}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      // The page's prefers-color-scheme follows BB's theme. A page that doesn't
      // opt into dark still gets the browser's light canvas.
      // Until the page reports its height, a fitted card keeps the old 320 px.
      style={{ colorScheme: dark ? "dark" : "light", ...(fit ? { height: height ?? 320 } : {}) }}
      className={fit ? "block w-full border-0" : "size-full border-0"}
    />
  );
}
