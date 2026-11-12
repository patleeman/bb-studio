export type StudioAutoUpdateFeed =
  | { owner: string; provider: "github"; repo: string; url?: undefined }
  | { provider: "generic"; url: string };

export interface StudioUpdateTest {
  debugPort: number;
  hostDaemonPort: number;
  root: string;
  serverPort: number;
}

export interface StudioBuild {
  test: StudioUpdateTest | null;
  updateFeed: StudioAutoUpdateFeed;
  upstreamCommit: string;
  upstreamVersion: string;
  version: string;
  versionFeedBaseUrl: string;
}

const UNSET_FEED_BASE_URL = "https://updates.invalid/bb-studio/desktop-latest/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFeed(value: unknown): StudioAutoUpdateFeed | null {
  if (!isRecord(value)) return null;
  if (
    value.provider === "github" &&
    typeof value.owner === "string" &&
    typeof value.repo === "string"
  ) {
    return { owner: value.owner, provider: "github", repo: value.repo };
  }
  if (value.provider === "generic" && typeof value.url === "string") {
    return { provider: "generic", url: value.url };
  }
  return null;
}

function parseTest(value: unknown): StudioUpdateTest | null {
  if (
    !isRecord(value) ||
    typeof value.root !== "string" ||
    typeof value.debugPort !== "number" ||
    typeof value.serverPort !== "number" ||
    typeof value.hostDaemonPort !== "number"
  ) {
    return null;
  }
  return {
    debugPort: value.debugPort,
    hostDaemonPort: value.hostDaemonPort,
    root: value.root,
    serverPort: value.serverPort,
  };
}

export function parseStudioBuild(raw: string | undefined): StudioBuild | null {
  if (raw === undefined || raw.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const updateFeed = parseFeed(value.updateFeed);
  if (
    updateFeed === null ||
    typeof value.version !== "string" ||
    typeof value.upstreamVersion !== "string" ||
    typeof value.upstreamCommit !== "string" ||
    typeof value.versionFeedBaseUrl !== "string"
  ) {
    return null;
  }
  return {
    test: parseTest(value.test),
    updateFeed,
    upstreamCommit: value.upstreamCommit,
    upstreamVersion: value.upstreamVersion,
    version: value.version,
    versionFeedBaseUrl: value.versionFeedBaseUrl,
  };
}

export function formatStudioBase(build: StudioBuild): string {
  return `based on bb ${build.upstreamVersion} @ ${build.upstreamCommit.slice(0, 7)}`;
}

export function formatStudioAboutVersion(
  version: string,
  build: StudioBuild | null,
): string {
  return build === null ? version : `${version} (${formatStudioBase(build)})`;
}

export const STUDIO_BUILD = parseStudioBuild(process.env.BB_STUDIO_BUILD);
export const STUDIO_UPDATES_ENABLED = STUDIO_BUILD !== null;
export const STUDIO_AUTO_UPDATE_FEED: StudioAutoUpdateFeed =
  STUDIO_BUILD?.updateFeed ?? { provider: "generic", url: UNSET_FEED_BASE_URL };
export const STUDIO_VERSION_FEED_BASE_URL =
  STUDIO_BUILD?.versionFeedBaseUrl ?? UNSET_FEED_BASE_URL;
