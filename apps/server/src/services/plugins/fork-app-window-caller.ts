import type { ExperimentalPluginRpcCaller } from "@get-bb/plugin-sdk";
import {
  UI_TOKEN_HEADER,
  uiTokenMatches,
} from "../fork-import/bring-over/ui-token.js";

/**
 * A plugin rpc caller as BB Studio sees it. `studioAppWindow` is set only for
 * a call from BB Studio's own app window on this Mac: a `client` call that
 * carries the per-launch app token (the bring-over token) and is neither an
 * agent's nor the bb CLI's. The SDK type stays upstream's; plugins read the
 * extra field through a cast and treat its absence as "not the app window".
 */
export type ForkPluginRpcCaller =
  | ExperimentalPluginRpcCaller
  | { readonly kind: "client"; readonly studioAppWindow: true };

const CALLER_THREAD_HEADER = "x-bb-caller-thread";
const CLI_HEADER = "x-bb-cli";

/**
 * Adds `studioAppWindow: true` to a `client` caller when the request proves it
 * came from the app window. Every other caller is returned unchanged, so on a
 * server the app did not start (no token hash) nothing ever gets the flag.
 */
export function forkAppWindowCaller(
  caller: ExperimentalPluginRpcCaller,
  header: (name: string) => string | undefined,
): ExperimentalPluginRpcCaller {
  if (caller.kind !== "client") return caller;
  if (header(CALLER_THREAD_HEADER) !== undefined) return caller;
  if (header(CLI_HEADER) !== undefined) return caller;
  if (!uiTokenMatches(header(UI_TOKEN_HEADER))) return caller;
  const flagged: ForkPluginRpcCaller = {
    kind: "client",
    studioAppWindow: true,
  };
  return flagged;
}
