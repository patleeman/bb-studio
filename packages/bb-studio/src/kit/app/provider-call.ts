import { z } from "zod";
import type { StudioSchemas } from "../contract";

type Provider = StudioSchemas["provider"];

/** Calls a kind's `studio_*` methods through the Studio provider. */
export type ProviderCall = <M extends keyof Provider>(
  method: M,
  input: z.input<Provider[M]["input"]>,
) => Promise<z.output<Provider[M]["output"]>>;
