import { z } from "zod";
export const moduleStatusContract = {
  modules_status: { input: z.null(), output: z.object({ active: z.array(z.string()), legacyInstalled: z.array(z.string()) }) },
};
