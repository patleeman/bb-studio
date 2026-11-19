import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export const FORK_IMPORT_SOURCE_ENV = "BB_STUDIO_IMPORT_FROM";

const PRODUCTION_DATA_DIR_NAME = ".bb-studio";
const DEFAULT_SOURCE_DIR_NAME = ".bb";

export function resolveForkImportSource(args: {
  dataDir: string;
  env: Readonly<Record<string, string | undefined>>;
}): string | null {
  const configured = args.env[FORK_IMPORT_SOURCE_ENV]?.trim();
  if (configured === "off") return null;
  if (configured !== undefined && configured.length > 0) {
    return resolve(configured);
  }
  return basename(resolve(args.dataDir)) === PRODUCTION_DATA_DIR_NAME
    ? join(homedir(), DEFAULT_SOURCE_DIR_NAME)
    : null;
}
