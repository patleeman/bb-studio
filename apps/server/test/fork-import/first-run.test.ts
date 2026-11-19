import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigratedConnection } from "@bb/db/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  forkBeforeDatabase,
  resolveForkImportSource,
} from "../../src/services/fork-import/first-run.js";
import { setForkImportDataDir } from "../../src/services/fork-import/index.js";
import { closeForkImportDatabases } from "../../src/services/fork-import/state.js";
import { copyMissingThreadStorage } from "../../src/services/fork-import/sync.js";
import { createMirroredInstall } from "./mirrored-install.js";

const roots: string[] = [];
const logger = { info: () => {}, warn: () => {} };

async function makeSource(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bb-fork-import-"));
  roots.push(root);
  const source = join(root, "source");
  await mkdir(join(source, "thread-storage", "thr_one"), { recursive: true });
  const memory = createMigratedConnection();
  await memory.$client.backup(join(source, "bb.db"));
  memory.$client.close();
  await writeFile(join(source, "host-id"), "host_source\n");
  await writeFile(join(source, "thread-storage", "thr_one", "note.txt"), "n");
  await writeFile(join(source, "thread-storage", "loose.png"), "p");
  return root;
}

function hashOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(async () => {
  closeForkImportDatabases();
  setForkImportDataDir(null);
  delete process.env.BB_STUDIO_IMPORT_FROM;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("first start", () => {
  it("copies nothing from bb and never touches it", async () => {
    const root = await makeSource();
    const source = join(root, "source");
    const target = join(root, "target");
    const before = hashOf(join(source, "bb.db"));
    process.env.BB_STUDIO_IMPORT_FROM = source;

    await forkBeforeDatabase(
      { BB_DATA_DIR: target, BB_APP_VERSION: "1.0.0" },
      logger,
    );

    const made = existsSync(target) ? readdirSync(target) : [];
    expect(made.filter((name) => name !== "fork-rail-reset.json")).toEqual([]);
    expect(hashOf(join(source, "bb.db"))).toBe(before);
    expect(readdirSync(root)).toEqual(
      existsSync(target) ? ["source", "target"] : ["source"],
    );
  });

  it("reads bb only from the packaged data dir unless a source is named, and can be turned off", () => {
    expect(
      resolveForkImportSource({ dataDir: "/tmp/dev-data", env: {} }),
    ).toBeNull();
    expect(
      resolveForkImportSource({ dataDir: "/Users/x/.bb-studio", env: {} }),
    ).toMatch(/\.bb$/u);
    expect(
      resolveForkImportSource({
        dataDir: "/Users/x/.bb-studio",
        env: { BB_STUDIO_IMPORT_FROM: "off" },
      }),
    ).toBeNull();
  });
});

describe("installs imported before 19 Nov keep their mirror", () => {
  it("copies thread storage once", async () => {
    const root = await makeSource();
    const source = join(root, "source");
    const target = join(root, "target");
    await createMirroredInstall({
      dataDir: target,
      sourceDataDir: source,
      now: 1000,
    });

    expect(await copyMissingThreadStorage({ dataDir: target, logger })).toBe(2);
    expect(
      readFileSync(join(target, "thread-storage", "loose.png"), "utf8"),
    ).toBe("p");
    expect(
      readFileSync(
        join(target, "thread-storage", "thr_one", "note.txt"),
        "utf8",
      ),
    ).toBe("n");
    expect(
      await copyMissingThreadStorage({ dataDir: target, logger }),
    ).toBeNull();
  });
});
