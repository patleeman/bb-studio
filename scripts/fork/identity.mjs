import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findIdentityOverlaps,
  formatIdentityTable,
  readCommitIdentity,
  readTreeIdentity,
} from "./identity-overlap.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(root, "scripts/fork/brand/icon.png");
const UPDATE_BASE = "https://updates.invalid/bb-studio/";
const UPSTREAM_UPDATE_BASE = "https://github.com/get-bb/bb/releases/download/";

const edits = [
  [
    "packages/config/src/runtime.ts",
    [
      [
        'const BB_PROD_DATA_DIR_NAME = ".bb";',
        'const BB_PROD_DATA_DIR_NAME = ".bb-studio";',
      ],
      [
        "export const BB_PROD_SERVER_PORT = 38886;",
        "export const BB_PROD_SERVER_PORT = 38986;",
      ],
      [
        "export const BB_PROD_HOST_DAEMON_PORT = 38887;",
        "export const BB_PROD_HOST_DAEMON_PORT = 38987;",
      ],
    ],
  ],
  [
    "apps/desktop/src/types.ts",
    [
      [
        "const DEFAULT_BB_SERVER_PORT = 38886;",
        "const DEFAULT_BB_SERVER_PORT = 38986;",
      ],
      [
        "export const STARTUP_TIMEOUT_MS = 60_000;",
        "export const STARTUP_TIMEOUT_MS = 600_000;",
      ],
    ],
  ],
  [
    "apps/desktop/src/main.ts",
    [
      [
        'return join(args.homeDir, ".bb");',
        'return join(args.homeDir, ".bb-studio");',
      ],
      ['? "dev.bb.desktop.nightly"', '? "nyc.plee.bbstudio.nightly"'],
      [': "dev.bb.desktop",', ': "nyc.plee.bbstudio",'],
      [
        "  DESKTOP_RELEASE_CHANNEL,\n",
        "  DESKTOP_RELEASE_CHANNEL,\n  DESKTOP_UPDATES_ENABLED,\n",
      ],
      [
        "    desktopUpdateService.start();",
        "    if (DESKTOP_UPDATES_ENABLED) desktopUpdateService.start();",
      ],
      [
        "    desktopAutoUpdateService.start();",
        "    if (DESKTOP_UPDATES_ENABLED) desktopAutoUpdateService.start();",
      ],
    ],
  ],
  [
    "apps/desktop/src/desktop-update-provider.ts",
    [
      [
        'appId: "dev.bb.desktop" | "dev.bb.desktop.nightly";',
        'appId: "nyc.plee.bbstudio" | "nyc.plee.bbstudio.nightly";',
      ],
      [
        'applicationName: "bb" | "bb Nightly";',
        'applicationName: "BB Studio" | "BB Studio Nightly";',
      ],
      [
        'appId: nightly ? "dev.bb.desktop.nightly" : "dev.bb.desktop",',
        'appId: nightly ? "nyc.plee.bbstudio.nightly" : "nyc.plee.bbstudio",',
      ],
      [
        'applicationName: nightly ? "bb Nightly" : "bb",',
        'applicationName: nightly ? "BB Studio Nightly" : "BB Studio",',
      ],
      [
        "import {\n  createBbDesktopVersionFeedFileName,",
        'import {\n  STUDIO_AUTO_UPDATE_FEED,\n  STUDIO_UPDATES_ENABLED,\n  STUDIO_VERSION_FEED_BASE_URL,\n  type StudioAutoUpdateFeed,\n} from "./studio-release.fork.js";\nimport {\n  createBbDesktopVersionFeedFileName,',
      ],
      [
        `updateReleaseBaseUrl: \`${UPSTREAM_UPDATE_BASE}\${releaseTag}/\`,`,
        "updateReleaseBaseUrl: STUDIO_VERSION_FEED_BASE_URL,",
      ],
      [
        "export const DESKTOP_RELEASE_CHANNEL = resolveBuiltDesktopReleaseChannel(",
        "export const DESKTOP_UPDATES_ENABLED = STUDIO_UPDATES_ENABLED;\n\nexport const DESKTOP_RELEASE_CHANNEL = resolveBuiltDesktopReleaseChannel(",
      ],
      [
        'export interface DesktopAutoUpdateFeedConfig {\n  channel: DesktopReleaseChannel;\n  provider: "generic";\n  url: string;\n}',
        "export type DesktopAutoUpdateFeedConfig = StudioAutoUpdateFeed & {\n  channel: DesktopReleaseChannel;\n};",
      ],
      [
        '  channel: DESKTOP_RELEASE_CHANNEL,\n  provider: "generic",\n  url: DESKTOP_UPDATE_RELEASE_BASE_URL,\n};',
        "  channel: DESKTOP_RELEASE_CHANNEL,\n  ...STUDIO_AUTO_UPDATE_FEED,\n};",
      ],
    ],
  ],
  [
    "apps/desktop/src/desktop-window-factory.ts",
    [['title: "bb",', 'title: "BB Studio",']],
  ],
  [
    "apps/desktop/scripts/desktop-release-channel.mjs",
    [
      [
        'appId: "dev.bb.desktop.nightly",',
        'appId: "nyc.plee.bbstudio.nightly",',
      ],
      [
        'applicationName: "bb Nightly",',
        'applicationName: "BB Studio Nightly",',
      ],
      ['appId: "dev.bb.desktop",', 'appId: "nyc.plee.bbstudio",'],
      ['applicationName: "bb",', 'applicationName: "BB Studio",'],
      [
        'artifactName: "${productName}-${version}-${arch}.${ext}",',
        'artifactName: "BB-Studio-${version}-${arch}.${ext}",',
      ],
      [UPSTREAM_UPDATE_BASE, UPDATE_BASE],
    ],
  ],
  [
    "apps/desktop/scripts/desktop-release-channel.d.mts",
    [
      [
        'appId: "dev.bb.desktop" | "dev.bb.desktop.nightly";',
        'appId: "nyc.plee.bbstudio" | "nyc.plee.bbstudio.nightly";',
      ],
      [
        'applicationName: "bb" | "bb Nightly";',
        'applicationName: "BB Studio" | "BB Studio Nightly";',
      ],
    ],
  ],
  [
    "apps/desktop/electron-builder.config.json",
    [
      ['"appId": "dev.bb.desktop",', '"appId": "nyc.plee.bbstudio",'],
      [
        '"productName": "bb",\n  "artifactName": "${productName}-${version}-${arch}.${ext}",',
        '"productName": "BB Studio",\n  "artifactName": "BB-Studio-${version}-${arch}.${ext}",\n  "extraMetadata": { "name": "bb-studio-desktop" },',
      ],
      [
        `${UPSTREAM_UPDATE_BASE}desktop-latest/`,
        `${UPDATE_BASE}desktop-latest/`,
      ],
      [
        '"NSAppleEventsUsageDescription": "bb lets',
        '"NSAppleEventsUsageDescription": "BB Studio lets',
      ],
      [
        '"NSMicrophoneUsageDescription": "bb uses',
        '"NSMicrophoneUsageDescription": "BB Studio uses',
      ],
    ],
  ],
];

let failed = false;
for (const [file, pairs] of edits) {
  const target = join(root, file);
  let text = readFileSync(target, "utf8");
  for (const [from, to] of pairs) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) {
      console.error(`NOT FOUND ${file}: ${from}`);
      failed = true;
      continue;
    }
    text = text.replaceAll(from, to);
  }
  writeFileSync(target, text);
}

const assets = join(root, "apps/desktop/assets");
const iconset = join(root, "scripts/fork/brand/icon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = String(size * scale);
    const name =
      scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
    execFileSync(
      "sips",
      ["-z", pixels, pixels, source, "--out", join(iconset, name)],
      { stdio: "ignore" },
    );
  }
}
for (const name of ["icon.icns", "icon-nightly.icns"]) {
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(assets, name)]);
}
for (const name of ["icon.png", "icon-nightly.png", "icon-dev.png"]) {
  execFileSync(
    "sips",
    ["-z", "1024", "1024", source, "--out", join(assets, name)],
    { stdio: "ignore" },
  );
}
rmSync(iconset, { recursive: true, force: true });

const upstreamBase = execFileSync(
  "git",
  ["merge-base", "HEAD", "upstream/main"],
  { cwd: root, encoding: "utf8" },
).trim();
const upstreamVersion = JSON.parse(
  readFileSync(join(root, "apps/desktop/package.json"), "utf8"),
).version;
writeFileSync(
  join(root, "apps/desktop/studio-upstream.json"),
  `${JSON.stringify({ version: upstreamVersion, commit: upstreamBase }, null, 2)}\n`,
);

const bbIdentity = readCommitIdentity(root, upstreamBase);
const studioIdentity = readTreeIdentity(root);
const overlaps = findIdentityOverlaps(bbIdentity, studioIdentity);
console.log(formatIdentityTable(bbIdentity, studioIdentity));
for (const key of overlaps) {
  console.error(`OVERLAP ${key}: BB Studio uses bb's ${bbIdentity[key]}`);
  failed = true;
}

if (failed) process.exitCode = 1;
console.log(
  `identity applied: BB Studio, nyc.plee.bbstudio, ~/.bb-studio, ports 38986 and 38987, updates from ${studioIdentity.updateFeed}, based on bb ${upstreamVersion} @ ${upstreamBase.slice(0, 7)}`,
);
