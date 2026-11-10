import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const one = (text, pattern, label) => {
  const match = pattern.exec(text);
  if (match === null) throw new Error(`could not read ${label}`);
  return match[1];
};

const sanitizeFileName = (name) => name.replace(/[/\\:*?"<>|]/g, "");

function urlSchemes(config) {
  const fromProtocols = [config.protocols ?? []]
    .flat()
    .flatMap((protocol) => protocol.schemes ?? []);
  const fromPlist = (config.mac?.extendInfo?.CFBundleURLTypes ?? []).flatMap(
    (type) => type.CFBundleURLSchemes ?? [],
  );
  return [...fromProtocols, ...fromPlist].sort();
}

function updateFeed(read) {
  const release = read("apps/desktop/studio-release.fork.json");
  if (release !== null) {
    const { owner, repo } = JSON.parse(release).updates;
    return `github.com/${owner}/${repo}`;
  }
  return `github.com/${one(
    read("apps/desktop/src/desktop-update-provider.ts"),
    /https:\/\/github\.com\/([^/]+\/[^/]+)\/releases/,
    "the update feed",
  )}`;
}

function version(read) {
  const release = read("apps/desktop/studio-release.fork.json");
  return JSON.parse(release ?? read("apps/desktop/package.json")).version;
}

export function readIdentity(read) {
  const config = JSON.parse(read("apps/desktop/electron-builder.config.json"));
  const runtime = read("packages/config/src/runtime.ts");
  const main = read("apps/desktop/src/main.ts");
  const channels = read("apps/desktop/scripts/desktop-release-channel.mjs");
  const packageName =
    config.extraMetadata?.name ??
    JSON.parse(read("apps/desktop/package.json")).name;
  const appId = config.appId;
  return {
    bundleId: appId,
    nightlyBundleId: one(
      channels,
      /appId: "([^"]+)",\n\s+applicationName: "[^"]+ Nightly"/,
      "the nightly app id",
    ),
    appName: config.productName,
    userDataDir: `~/Library/Application Support/${config.productName}`,
    dataDir: `~/${one(runtime, /BB_PROD_DATA_DIR_NAME = "([^"]+)"/, "the data dir")}`,
    desktopDataDir: `~/${one(main, /return join\(args\.homeDir, "([^"]+)"\);/, "the desktop data dir")}`,
    serverPort: one(runtime, /BB_PROD_SERVER_PORT = (\d+);/, "the server port"),
    hostDaemonPort: one(
      runtime,
      /BB_PROD_HOST_DAEMON_PORT = (\d+);/,
      "the host daemon port",
    ),
    urlSchemes: urlSchemes(config).join(", ") || "none",
    keychainService: `${config.productName} Safe Storage`,
    updateFeed: updateFeed(read),
    updaterCacheDir: `~/Library/Caches/${sanitizeFileName(packageName).toLowerCase()}-updater`,
    shipItCache: `~/Library/Caches/${appId}.ShipIt`,
    version: version(read),
  };
}

export function readTreeIdentity(root) {
  return readIdentity((path) => {
    const full = join(root, path);
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  });
}

export function readCommitIdentity(root, commit) {
  return readIdentity((path) => {
    try {
      return execFileSync("git", ["show", `${commit}:${path}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return null;
    }
  });
}

export function findIdentityOverlaps(bb, studio) {
  const overlaps = [];
  for (const key of Object.keys(bb)) {
    if (key === "urlSchemes") {
      const ours = new Set(studio.urlSchemes.split(", "));
      const shared = bb.urlSchemes
        .split(", ")
        .filter((scheme) => scheme !== "none" && ours.has(scheme));
      if (shared.length > 0) overlaps.push(key);
      continue;
    }
    if (key === "version") {
      if (
        bb.version === studio.version ||
        Number(studio.version.split(".")[0]) < 1
      ) {
        overlaps.push(key);
      }
      continue;
    }
    if (bb[key] === studio[key]) overlaps.push(key);
  }
  return overlaps;
}

export function formatIdentityTable(bb, studio) {
  const width = Math.max(...Object.keys(bb).map((key) => key.length));
  return Object.keys(bb)
    .map(
      (key) => `${key.padEnd(width)}  bb: ${bb[key]}  |  BB Studio: ${studio[key]}`,
    )
    .join("\n");
}
