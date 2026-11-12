import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const STUDIO_RELEASE_PATH = resolve(
  desktopRoot,
  "studio-release.fork.json",
);
export const STUDIO_UPSTREAM_PATH = resolve(desktopRoot, "studio-upstream.json");
export const STUDIO_UPDATE_TEST_ENV = "BB_STUDIO_UPDATE_TEST";
export const STUDIO_UPDATE_TEST_IDENTITY = {
  appId: "nyc.plee.bbstudio.updatetest",
  debugPort: 9339,
  hostDaemonPort: 38997,
  packageName: "bb-studio-updatetest",
  productName: "BB Studio Update Test",
  serverPort: 38996,
};

const SEMVER = /^\d+\.\d+\.\d+$/;

export function assertStudioVersion(version, label) {
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error(`${label} must be a plain x.y.z version, got ${version}`);
  }
  if (Number(version.split(".")[0]) < 1) {
    throw new Error(
      `${label} must be 1.0.0 or higher: installed copies report 0.49.x, and electron-updater only offers higher versions`,
    );
  }
  return version;
}

export function parseStudioRelease(text) {
  const release = JSON.parse(text);
  assertStudioVersion(release.version, "studio-release.fork.json version");
  const updates = release.updates;
  if (
    updates?.provider !== "github" ||
    typeof updates.owner !== "string" ||
    typeof updates.repo !== "string" ||
    updates.owner.length === 0 ||
    updates.repo.length === 0
  ) {
    throw new Error(
      "studio-release.fork.json updates must be a github provider with an owner and a repo",
    );
  }
  return {
    version: release.version,
    updates: {
      provider: "github",
      owner: updates.owner,
      repo: updates.repo,
    },
  };
}

export function readStudioRelease(path = STUDIO_RELEASE_PATH) {
  return parseStudioRelease(readFileSync(path, "utf8"));
}

export function readStudioUpstream(path = STUDIO_UPSTREAM_PATH) {
  let upstream;
  try {
    upstream = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      `${path} is missing: it is written by scripts/fork/identity.mjs; run the generators first`,
    );
  }
  if (
    typeof upstream.version !== "string" ||
    !/^[0-9a-f]{40}$/.test(upstream.commit ?? "")
  ) {
    throw new Error(`${path} must hold bb's version and a full commit sha`);
  }
  return { version: upstream.version, commit: upstream.commit };
}

export function readStudioUpdateTest(env) {
  const raw = env[STUDIO_UPDATE_TEST_ENV]?.trim() ?? "";
  if (raw.length === 0) return null;
  const test = JSON.parse(raw);
  if (typeof test.root !== "string" || !test.root.startsWith("/")) {
    throw new Error(`${STUDIO_UPDATE_TEST_ENV}.root must be an absolute path`);
  }
  if (
    typeof test.feedUrl !== "string" ||
    (test.feedUrl !== "github" &&
      !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(test.feedUrl))
  ) {
    throw new Error(
      `${STUDIO_UPDATE_TEST_ENV}.feedUrl must be http://127.0.0.1:<port>/ or github`,
    );
  }
  return {
    feedUrl: test.feedUrl,
    root: test.root,
    version:
      test.version === undefined
        ? null
        : assertStudioVersion(test.version, `${STUDIO_UPDATE_TEST_ENV}.version`),
  };
}

export function githubLatestDownloadUrl(updates) {
  return `https://github.com/${updates.owner}/${updates.repo}/releases/latest/download/`;
}

export function createStudioBuild({ release, upstream, test }) {
  if (test === null) {
    return {
      version: release.version,
      upstreamVersion: upstream.version,
      upstreamCommit: upstream.commit,
      updateFeed: release.updates,
      versionFeedBaseUrl: githubLatestDownloadUrl(release.updates),
      test: null,
    };
  }
  return {
    version: test.version ?? release.version,
    upstreamVersion: upstream.version,
    upstreamCommit: upstream.commit,
    updateFeed:
      test.feedUrl === "github"
        ? release.updates
        : { provider: "generic", url: test.feedUrl },
    versionFeedBaseUrl:
      test.feedUrl === "github"
        ? githubLatestDownloadUrl(release.updates)
        : test.feedUrl,
    test: {
      debugPort: STUDIO_UPDATE_TEST_IDENTITY.debugPort,
      root: test.root,
      serverPort: STUDIO_UPDATE_TEST_IDENTITY.serverPort,
      hostDaemonPort: STUDIO_UPDATE_TEST_IDENTITY.hostDaemonPort,
    },
  };
}

export function readStudioBuild(env = process.env) {
  return createStudioBuild({
    release: readStudioRelease(),
    upstream: readStudioUpstream(),
    test: readStudioUpdateTest(env),
  });
}

export function studioBuildDefines(build) {
  return {
    "process.env.BB_DESKTOP_VERSION": JSON.stringify(build.version),
    "process.env.BB_STUDIO_BUILD": JSON.stringify(JSON.stringify(build)),
  };
}

export function applyStudioBuilderConfig(config, build) {
  config.extraMetadata = {
    ...config.extraMetadata,
    version: build.version,
  };
  config.publish = [{ ...build.updateFeed, channel: "latest" }];
  if (build.test !== null) {
    config.extraMetadata.name = STUDIO_UPDATE_TEST_IDENTITY.packageName;
    config.appId = STUDIO_UPDATE_TEST_IDENTITY.appId;
    config.productName = STUDIO_UPDATE_TEST_IDENTITY.productName;
  }
  return config;
}
