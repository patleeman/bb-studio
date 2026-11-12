import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { skySchema } from "./sky";

export const forestContract = defineRpcContract({
  "theme.weather": {
    experimental_description: "Forest theme's place and current weather (Open-Meteo, cached 20 minutes). timeZone: the computer's IANA time zone, used for a coarse place when no city is set.",
    input: z.object({ timeZone: z.string().max(80).nullable() }).strict(),
    output: skySchema,
  },
  "theme.weather.city": {
    experimental_description: "Sets the Forest theme's city (looked up with Open-Meteo geocoding), or null to use the time zone's place.",
    input: z.object({ city: z.string().trim().min(1).max(120).nullable() }).strict(),
    output: skySchema,
  },
});
