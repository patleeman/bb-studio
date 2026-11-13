import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function runtimeFile(specifier: string, bundled: string = specifier): string {
  const copy = join(here, "runtime", bundled);
  return existsSync(copy) ? copy : createRequire(import.meta.url).resolve(specifier);
}
