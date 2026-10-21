import { z } from "zod";
import { rpcContract as legacy } from "@bb-studio/kit/decisions-legacy-contract";
export const decisionMethods = {
  "decisions.systemOne.ask": legacy["systemOne.ask"],
  "decisions.model.ask": legacy["model.ask"],
  "decisions.fallback.get": legacy["fallback.get"],
  "decisions.fallback.set": legacy["fallback.set"],
  "decisions.fallback.suggest": legacy["fallback.suggest"],
  "decisions.jev.status": legacy["jev.status"],
  "decisions.jev.check": legacy["jev.check"],
};
export const rpcContract = {
  ...decisionMethods,
  "decisions.cli": {
    input: z.object({ argv: z.array(z.string().max(16000)).max(100) }).strict(),
    output: z.object({ exitCode: z.number(), stdout: z.string().optional(), stderr: z.string().optional() }),
  },
};
