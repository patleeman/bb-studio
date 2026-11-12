import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const skillsRegistryStateSchema = z.object({
  enabled: z.boolean(),
  pending: z.boolean(),
  gated: z.boolean(),
  error: z.string().nullable(),
});
export type SkillsRegistryState = z.infer<typeof skillsRegistryStateSchema>;

export const skillsRegistryContract = defineRpcContract({
  "skillsRegistry.state": {
    experimental_description: "Whether BB's public skill registry (skills.sh) is on in BB Studio. It is off by default.",
    input: z.null(),
    output: skillsRegistryStateSchema,
  },
  "skillsRegistry.set": {
    experimental_description: "Turn the public skill registry off, or ask the person to turn it on. Turning it on waits for an approval only a person can give.",
    input: z.object({ enabled: z.boolean() }).strict(),
    output: skillsRegistryStateSchema,
  },
});
