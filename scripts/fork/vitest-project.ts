import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORK_SKIP_SETUP = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "vitest-skips.ts",
);
