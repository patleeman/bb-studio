// Recordings' Studio provider methods (`studio_*`), from Studio's own app.
// They aren't RPC methods of their own: Studio runs them in-process for
// provider.call, as it does for other add-ons (kit callProvider).
import type { ProviderCall } from "@bb-studio/kit/app";
import { STUDIO_PROVIDER_CALL_METHOD } from "@bb-studio/kit/contract";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import type { builtinProviderContract } from "../../builtin-provider";
import { PLUGIN_ID } from "../shared/format";

export function useRecordingProvider(): ProviderCall {
  const rpc = useRpc<typeof builtinProviderContract>();
  return useMemo(() => ((method, input) => rpc.call(STUDIO_PROVIDER_CALL_METHOD, { pluginId: PLUGIN_ID, method, input })) as ProviderCall, [rpc]);
}
