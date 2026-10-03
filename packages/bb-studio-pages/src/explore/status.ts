import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const exploreStatusContract = defineRpcContract({
  exploreStatus: { input: z.null(), output: z.object({ active: z.boolean(), legacyInstalled: z.boolean() }) },
});
