import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { windowsContract } from "./contract";
import { MAIN_WINDOW_CHANNEL } from "./shared";

export function windowRelayHandlers(publish: (channel: string, payload: unknown) => void) {
  return {
    "window.openInMain": ({ path }: { path: string }) => {
      publish(MAIN_WINDOW_CHANNEL, { path });
      return { ok: true as const };
    },
    "window.runInMain": (input: { kind: "command"; commandId: string } | { kind: "url"; url: string } | { kind: "link"; link: string; how: string }) => {
      publish(MAIN_WINDOW_CHANNEL, input.kind === "command" ? { command: input.commandId } : input.kind === "url" ? { url: input.url } : { link: input.link, how: input.how });
      return { ok: true as const };
    },
  };
}

export function registerWindowRelay(bb: BbPluginApi): void {
  bb.rpc.register(windowsContract, windowRelayHandlers((channel, payload) => { void bb.realtime.publish(channel, payload as never); }));
}
