import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  findIdentityOverlaps,
  readCommitIdentity,
  readTreeIdentity,
} from "./identity-overlap.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const generated = existsSync(join(root, "apps/desktop/studio-upstream.json"));

const bb = {
  bundleId: "dev.bb.desktop",
  nightlyBundleId: "dev.bb.desktop.nightly",
  appName: "bb",
  userDataDir: "~/Library/Application Support/bb",
  dataDir: "~/.bb",
  desktopDataDir: "~/.bb",
  serverPort: "38886",
  hostDaemonPort: "38887",
  urlSchemes: "none",
  keychainService: "bb Safe Storage",
  updateFeed: "github.com/get-bb/bb",
  updaterCacheDir: "~/Library/Caches/@bbdesktop-updater",
  shipItCache: "~/Library/Caches/dev.bb.desktop.ShipIt",
  version: "0.49.0",
};

test(
  "BB Studio shares no identifier with the bb it is based on",
  { skip: generated ? false : "run after scripts/fork/identity.mjs" },
  () => {
    const base = execFileSync("git", ["merge-base", "HEAD", "upstream/main"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const upstream = readCommitIdentity(root, base);
    const studio = readTreeIdentity(root);
    assert.equal(upstream.bundleId, "dev.bb.desktop");
    assert.equal(upstream.updateFeed, "github.com/get-bb/bb");
    assert.deepEqual(findIdentityOverlaps(upstream, studio), []);
    assert.deepEqual(findIdentityOverlaps(bb, studio), []);
  },
);

test("each identifier is flagged when it matches bb's", () => {
  const studio = {
    bundleId: "nyc.plee.bbstudio",
    nightlyBundleId: "nyc.plee.bbstudio.nightly",
    appName: "BB Studio",
    userDataDir: "~/Library/Application Support/BB Studio",
    dataDir: "~/.bb-studio",
    desktopDataDir: "~/.bb-studio",
    serverPort: "38986",
    hostDaemonPort: "38987",
    urlSchemes: "none",
    keychainService: "BB Studio Safe Storage",
    updateFeed: "github.com/patleeman/bb-studio",
    updaterCacheDir: "~/Library/Caches/bb-studio-desktop-updater",
    shipItCache: "~/Library/Caches/nyc.plee.bbstudio.ShipIt",
    version: "1.0.0",
  };
  assert.deepEqual(findIdentityOverlaps(bb, studio), []);
  for (const key of Object.keys(bb)) {
    if (key === "urlSchemes" || key === "version") continue;
    assert.deepEqual(
      findIdentityOverlaps(bb, { ...studio, [key]: bb[key] }),
      [key],
      key,
    );
  }
  assert.deepEqual(
    findIdentityOverlaps(
      { ...bb, urlSchemes: "bb" },
      { ...studio, urlSchemes: "bb, bbstudio" },
    ),
    ["urlSchemes"],
  );
  assert.deepEqual(
    findIdentityOverlaps(bb, { ...studio, version: "0.49.0" }),
    ["version"],
  );
  assert.deepEqual(
    findIdentityOverlaps(bb, { ...studio, version: "0.1.0" }),
    ["version"],
  );
});
