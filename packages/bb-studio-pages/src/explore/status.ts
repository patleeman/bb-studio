import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** Whether Explore runs in Pages, or the standalone Explore plugin is still in charge. */
export const exploreStatusContract = defineRpcContract({
  exploreStatus: { input: z.null(), output: z.object({ active: z.boolean(), legacyInstalled: z.boolean() }) },
});
