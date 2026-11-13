import { execFileSync, spawnSync } from "node:child_process";
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
    "packages/config/src/env-vars.ts",
    [
      [
        /export const DEFAULT_BB_POSTHOG_API_KEY =\s*"phc_[A-Za-z0-9]+";/,
        'export const DEFAULT_BB_POSTHOG_API_KEY = "";',
      ],
      [
        "export const DEFAULT_BB_TELEMETRY = true;",
        "export const DEFAULT_BB_TELEMETRY = false;",
      ],
      [
        'export const DEFAULT_BB_MARKETPLACE_URL =\n  "https://getbb.app/marketplace/v2/marketplace.json";',
        'export const DEFAULT_BB_MARKETPLACE_URL = "";',
      ],
    ],
  ],
  [
    "apps/server/src/services/plugins/builtin-registry.ts",
    [
      [
        '    name: "bb-account",\n    pluginId: "bb-account",\n    defaultEnabled: true,',
        '    name: "bb-account",\n    pluginId: "bb-account",\n    defaultEnabled: false,',
      ],
      [
        '    name: "connect",\n    pluginId: "connect",\n    defaultEnabled: true,',
        '    name: "connect",\n    pluginId: "connect",\n    defaultEnabled: false,',
      ],
    ],
  ],
  [
    "packages/domain/src/feature-flags.ts",
    [
      [
        "initiatorTelemetry: z.boolean().default(true),",
        "initiatorTelemetry: z.boolean().default(false),",
      ],
      [
        "  initiatorTelemetry: true,\n  timelineWindowEventBudget",
        "  initiatorTelemetry: false,\n  timelineWindowEventBudget",
      ],
    ],
  ],
  [
    "apps/app/src/lib/system-config-atoms.ts",
    [
      [
        "    initiatorTelemetry: true,\n    timelineWindowEventBudget",
        "    initiatorTelemetry: false,\n    timelineWindowEventBudget",
      ],
    ],
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    [
      [
        '        <SettingsWithControl\n          label="Share anonymous usage data"\n          description="Send anonymous usage data, such as app starts, setup progress and feature use, to help improve bb. Turning this off takes effect immediately for this server."\n        >\n          <Switch\n            checked={telemetryEnabled}\n            disabled={disabled}\n            onCheckedChange={onTelemetryEnabledChange}\n            aria-label="Share anonymous usage data"\n          />\n        </SettingsWithControl>\n\n',
        "",
      ],
      [
        "  onStreamerModeChange,\n  telemetryEnabled,\n  onTelemetryEnabledChange,\n}: PrivacySettingsSectionProps) {",
        "  onStreamerModeChange,\n}: PrivacySettingsSectionProps) {",
      ],
    ],
  ],
  [
    "apps/app/src/components/settings/settings-search.ts",
    [
      [
        '      {\n        title: "Share anonymous usage data",\n        keywords: ["privacy", "telemetry", "analytics"],\n      },\n',
        "",
      ],
    ],
  ],
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
    const found =
      from instanceof RegExp ? from.test(text) : text.includes(from);
    if (to === "" ? !found : text.includes(to)) continue;
    if (!found) {
      console.error(`NOT FOUND ${file}: ${from}`);
      failed = true;
      continue;
    }
    text =
      from instanceof RegExp
        ? text.replace(from, to)
        : text.replaceAll(from, to);
  }
  writeFileSync(target, text);
}

const absent = [
  ["apps/app/src/views/SettingsView.tsx", "Share anonymous usage data"],
  [
    "apps/app/src/components/settings/settings-search.ts",
    "Share anonymous usage data",
  ],
];
for (const [file, text] of absent) {
  if (!readFileSync(join(root, file), "utf8").includes(text)) continue;
  console.error(`STILL PRESENT ${file}: ${text}`);
  failed = true;
}

const KNOWN_TELEMETRY_FILES = new Set([
  "apps/server/src/services/system/telemetry.ts",
  "apps/server/src/services/system/setup-guide-experiment.ts",
]);
const telemetryGrep = spawnSync(
  "git",
  [
    "grep",
    "-l",
    "-E",
    "https?://[a-z0-9.-]*(posthog|sentry|segment|amplitude|mixpanel)\\.(com|io)",
    "--",
    "apps/app/src",
    "apps/desktop/src",
    "apps/server/src",
    "apps/host-daemon/src",
    "packages/*/src",
    "plugins",
    ":!*.test.*",
    ":!*.stories.*",
  ],
  { cwd: root, encoding: "utf8" },
);
for (const file of telemetryGrep.stdout.split("\n").filter(Boolean)) {
  if (KNOWN_TELEMETRY_FILES.has(file)) continue;
  console.error(
    `TELEMETRY HOST in ${file}: check that BB Studio does not send to it, then add the file to KNOWN_TELEMETRY_FILES`,
  );
  failed = true;
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
  `identity applied: BB Studio, nyc.plee.bbstudio, ~/.bb-studio, ports 38986 and 38987, updates from ${studioIdentity.updateFeed}, no usage telemetry, no bb Community catalog, bb account and connect off, based on bb ${upstreamVersion} @ ${upstreamBase.slice(0, 7)}`,
);
