// How the Tool Gateway page talks to Studio's server. Reads go through the
// app's RPC client like any other page. Changes go through a direct fetch
// that carries this launch's app token (the bring-over token), so the fork
// marks the call as coming from BB Studio's window (experimental_caller.
// studioAppWindow). In a browser, on the phone or on stock bb there is no
// token, and the page is read-only.
import { uiToken } from "../../bring-over/api";
import type { z } from "zod";
import type { toolGatewayContract } from "../contract";

type Contract = typeof toolGatewayContract;
export type Method = keyof Contract & string;
type Input<M extends Method> = z.input<Contract[M]["input"]>;
type Output<M extends Method> = z.output<Contract[M]["output"]>;

const RPC_BASE = "/api/v1/plugins/studio/rpc";

function messageOf(error: unknown, status: number): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return `BB Studio answered ${String(status)}`;
}

/** Calls a Tool Gateway RPC. With the app token when there is one; the server decides what it allows. */
export async function call<M extends Method>(method: M, input: Input<M>, load: typeof fetch = fetch): Promise<Output<M>> {
  const token = await uiToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-bb-studio-ui-token"] = token;
  const response = await load(`${RPC_BASE}/${method}`, { method: "POST", headers, body: JSON.stringify(input ?? null) });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; error?: unknown };
  if (!response.ok || body.ok !== true) throw new Error(messageOf(body.error, response.status));
  return body.result as Output<M>;
}

let appWindow: Promise<boolean> | null = null;
/** Whether this page may change anything: BB Studio's own window, on a server that knows its token. */
export function canChange(): Promise<boolean> {
  appWindow ??= (async () => {
    if (!(await uiToken())) return false;
    try {
      return (await call("toolGateway.whoami", null)).appWindow;
    } catch {
      return false;
    }
  })();
  return appWindow;
}
export function resetCanChangeForTests(): void { appWindow = null; }

export const READ_ONLY_NOTE = "Changes need the BB Studio app on this Mac.";

export function bytes(value: number | null): string | null {
  if (value === null) return null;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export const STATUS_LABEL = {
  "needs-approval": "Needs approval",
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  "needs-sign-in": "Needs sign-in",
  error: "Error",
  off: "Off",
} as const;

export const KIND_LABEL = { stdio: "Command", "streamable-http": "HTTP", sse: "SSE" } as const;
