import { resolve } from "node:path";
import type { ServerLogger } from "../../types.js";
import { resetForkRailPreferences } from "./fork-rail-reset.js";
import { setForkImportDataDir } from "./index.js";

export {
  FORK_IMPORT_SOURCE_ENV,
  resolveForkImportSource,
} from "./import-source.js";

export async function forkBeforeDatabase(
  serverConfig: { BB_DATA_DIR: string; BB_APP_VERSION: string },
  logger: Pick<ServerLogger, "info" | "warn">,
): Promise<void> {
  const dataDir = resolve(serverConfig.BB_DATA_DIR);
  setForkImportDataDir(dataDir);
  try {
    resetForkRailPreferences(dataDir, Date.now());
  } catch (error) {
    logger.warn({ error }, "fork rail preferences were not reset");
  }
}
