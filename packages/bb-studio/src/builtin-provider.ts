// Server only: Studio's `provider.call`, which runs a built-in kind's
// `studio_*` method for another add-on (kit callProvider).
import { STUDIO_PROVIDER_CALL_METHOD } from "./kit/contract";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { schemas } from "./contract";

const providerMethod = z.enum(Object.keys(schemas.provider) as [keyof typeof schemas.provider, ...(keyof typeof schemas.provider)[]]);

/** A built-in kind's provider method, for other add-ons; the hub parses input and output. */
export const builtinProviderContract = defineRpcContract({
  [STUDIO_PROVIDER_CALL_METHOD]: {
    input: z.object({ pluginId: z.string().min(1).max(100), method: providerMethod, input: z.unknown() }),
    output: z.unknown(),
  },
});
