export interface StudioGithubFeed {
  provider: "github";
  owner: string;
  repo: string;
}

export interface StudioRelease {
  version: string;
  updates: StudioGithubFeed;
}

export interface StudioUpstream {
  version: string;
  commit: string;
}

export interface StudioUpdateTestInput {
  feedUrl: string;
  root: string;
  version: string | null;
}

export interface StudioBuildInfo {
  version: string;
  upstreamVersion: string;
  upstreamCommit: string;
  updateFeed: StudioGithubFeed | { provider: "generic"; url: string };
  versionFeedBaseUrl: string;
  test: {
    debugPort: number;
    root: string;
    serverPort: number;
    hostDaemonPort: number;
  } | null;
}

export const STUDIO_RELEASE_PATH: string;
export const STUDIO_UPSTREAM_PATH: string;
export const STUDIO_UPDATE_TEST_ENV: "BB_STUDIO_UPDATE_TEST";
export const STUDIO_UPDATE_TEST_IDENTITY: {
  appId: string;
  debugPort: number;
  hostDaemonPort: number;
  packageName: string;
  productName: string;
  serverPort: number;
};

export function assertStudioVersion(version: unknown, label: string): string;
export function parseStudioRelease(text: string): StudioRelease;
export function readStudioRelease(path?: string): StudioRelease;
export function readStudioUpstream(path?: string): StudioUpstream;
export function readStudioUpdateTest(
  env: NodeJS.ProcessEnv,
): StudioUpdateTestInput | null;
export function githubLatestDownloadUrl(updates: StudioGithubFeed): string;
export function createStudioBuild(args: {
  release: StudioRelease;
  upstream: StudioUpstream;
  test: StudioUpdateTestInput | null;
}): StudioBuildInfo;
export function readStudioBuild(env?: NodeJS.ProcessEnv): StudioBuildInfo;
export function studioBuildDefines(
  build: StudioBuildInfo,
): Record<string, string>;
export function applyStudioBuilderConfig<T extends Record<string, unknown>>(
  config: T,
  build: StudioBuildInfo,
): T & {
  extraMetadata: Record<string, unknown>;
  publish: Array<Record<string, unknown>>;
  appId?: string;
  productName?: string;
};
