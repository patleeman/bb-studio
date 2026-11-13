#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertStudioVersion,
  parseStudioRelease,
  STUDIO_UPDATE_TEST_ENV,
} from "../../apps/desktop/scripts/studio-release.fork.mjs";
import { bumpProblems, foldVersion } from "./release-bump.mjs";
import {
  caffeinateArgs,
  keychainProblem,
  maskArgs,
  NOTARY_ENV_FILE,
  notaryApiKey,
  notaryArgs,
} from "./release-unattended.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const flag = (name) => args.includes(name);

const HELP = `Build, sign, notarize and draft a BB Studio desktop release.

  node scripts/fork/release-desktop.mjs --bump patch|minor|major | --version x.y.z
  node scripts/fork/release-desktop.mjs --no-bump [--notes <file>] [--since <ref>]
                                        [--repo owner/name] [--from build|sign|publish]
                                        [--dry-run]
  node scripts/fork/release-desktop.mjs --no-bump --notes-only [--since <ref>]
  node scripts/fork/release-desktop.mjs --no-bump --build-only

Run it in the desktop worktree. The Studio version is apps/desktop/studio-release.fork.json.

--bump / --version   Write the next version into the stack: fold it into the
                     commit that owns the version file, regenerate with sync.mjs
                     into desktop-candidate, check that only the version changed,
                     and stop. Promote, import and push as usual, then run again
                     with --no-bump.
--no-bump            Release the version the desktop branch already has.
--notes <file>       Use these notes. Without it the notes are drafted from the
                     commits since the last Studio tag (or --since <ref>) and
                     written to <work>/release-notes-v<version>.md.
--notes-only         Write the draft notes and stop.
--repo <owner/name>  The repository that gets the tag and the draft release
                     (default patleeman/bb-studio). Its git remote in the
                     monorepo gets the tag. The app's update feed is
                     apps/desktop/studio-release.fork.json, whatever --repo is.
--from <step>        Resume in an existing release worktree: build (default),
                     sign (notarize, staple, zip, feed files) or publish.
--dry-run            Check, draft the notes and print the plan. Nothing is
                     built, tagged, pushed or uploaded.
--build-only         Build the app and DMG in <work>/build-v<version> and stop:
                     signed when CSC_NAME is set, never notarized, tagged or
                     uploaded. For testing a fresh install.

Studio and Visual Chat are bundled with the app as built-in plugins
(scripts/fork/bundle-studio-plugins.mjs): plugins/ is taken from the
monorepo's origin/main, installed with pnpm and built with the release
worktree's CLI into bb-app's builtin-plugins before electron-builder runs.

It builds in <work>/release-v<version> (BB_STUDIO_SYNC_DIR, default
../.bb-studio-fork-sync), signs with CSC_NAME, notarizes with the App Store
Connect API key (BB_STUDIO_NOTARY_KEY_PATH, BB_STUDIO_NOTARY_KEY_ID and
BB_STUDIO_NOTARY_ISSUER, else ASC_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID in
${NOTARY_ENV_FILE}; the values are never printed) or, with no key, the
notarytool keychain profile BB_STUDIO_NOTARY_PROFILE (default bbstudio-notary), tags
v<version> on the monorepo's main and pushes the tag to --repo, and creates or
updates a DRAFT release there with the notes, the DMG, the zip, both blockmaps,
latest-mac.yml and desktop-version.json. It never publishes the release.

It runs unattended on a locked Mac: caffeinate -i holds off sleep until it
exits, and before the build it fails if the login keychain is locked, CSC_NAME
is not a listed signing identity or the notary key file is missing.`;

if (flag("--help")) {
  console.log(HELP);
  process.exit(0);
}

const REPO = option("--repo", "patleeman/bb-studio");
const DRY = flag("--dry-run");
const BUILD_ONLY = flag("--build-only");
const STEPS = ["build", "sign", "publish"];
const FROM = option("--from", "build");
const PROFILE = process.env.BB_STUDIO_NOTARY_PROFILE ?? "bbstudio-notary";
const NOTARY_KEY = notaryApiKey();
const syncRoot =
  process.env.BB_STUDIO_SYNC_DIR ?? resolve(root, "..", ".bb-studio-fork-sync");
const monorepo = resolve(
  process.env.BB_STUDIO_MONOREPO ?? resolve(root, "..", "bb-studio-app"),
);
const COAUTHOR = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
const VERSION_FILE = "apps/desktop/studio-release.fork.json";

function fail(message) {
  console.error(`release-desktop: ${message}`);
  process.exit(1);
}

if (!STEPS.includes(FROM)) fail(`--from must be one of ${STEPS.join(", ")}`);

if (DRY) {
  step("Keep awake");
  plan(`caffeinate ${caffeinateArgs("<pid>").join(" ")} (detached, ends with this run)`);
} else {
  spawn("caffeinate", caffeinateArgs(process.pid), {
    detached: true,
    stdio: "ignore",
  }).unref();
}

const run = (cwd, command, argv, options = {}) => {
  if (argv.some((arg) => /^--draft=false$/i.test(arg))) {
    fail("refusing to publish a release");
  }
  const result = spawnSync(command, argv, {
    cwd,
    encoding: "utf8",
    env: options.env ?? childEnv(),
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0 && !options.allowFailure) {
    if (options.capture) process.stderr.write(result.stderr ?? "");
    fail(`${command} ${argv[0] ?? ""} failed`);
  }
  return result;
};
const git = (cwd, ...argv) =>
  execFileSync("git", argv, { cwd, encoding: "utf8" }).trim();
const tryGit = (cwd, ...argv) =>
  spawnSync("git", argv, { cwd, encoding: "utf8" });

function childEnv() {
  const env = { ...process.env };
  delete env[STUDIO_UPDATE_TEST_ENV];
  return env;
}

function step(title) {
  console.log(`\n== ${title}`);
}

function plan(command) {
  console.log(`  would run: ${command}`);
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function bumpVersion(version, kind) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  return fail(`--bump must be patch, minor or major, got ${kind}`);
}

function studioTags() {
  return git(monorepo, "tag", "--list", "v*")
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .filter((tag) => Number(tag.slice(1).split(".")[0]) >= 1)
    .sort((a, b) => compareVersions(a.slice(1), b.slice(1)));
}

function generated(commit) {
  return (
    git(
      root,
      "log",
      "-1",
      "--format=%(trailers:key=Fork-Generated,valueonly)",
      commit,
    ) !== ""
  );
}

function generatedCount(tip) {
  let count = 0;
  for (let commit = tip; generated(commit); commit = git(root, "rev-parse", `${commit}^`)) count += 1;
  return count;
}

function handTip(tip) {
  let commit = tip;
  while (generated(commit)) commit = git(root, "rev-parse", `${commit}^`);
  return commit;
}

function forkSubjects(tip) {
  const base = git(root, "merge-base", tip, "upstream/main");
  return git(root, "log", "--format=%H%x09%s", `${base}..${tip}`)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([commit]) => !generated(commit))
    .map(([, subject]) => subject);
}

function upstreamOf(tip) {
  const recorded = tryGit(root, "show", `${tip}:apps/desktop/studio-upstream.json`);
  if (recorded.status === 0) return JSON.parse(recorded.stdout);
  const commit = git(root, "merge-base", tip, "upstream/main");
  const version = JSON.parse(
    git(root, "show", `${commit}:apps/desktop/package.json`),
  ).version;
  return { version, commit };
}

function desktopTipAt(ref) {
  const line = git(
    monorepo,
    "log",
    "-1",
    "--merges",
    "--grep=^desktop: import",
    "--format=%P",
    ref,
  );
  const parents = line.split(" ");
  if (parents.length < 2) fail(`no desktop import found below ${ref}`);
  return parents[1];
}

function draftNotes({ version, since, desktopTip }) {
  const upstream = upstreamOf(desktopTip);
  const lines = [
    `BB Studio ${version} (based on bb ${upstream.version} @ ${upstream.commit.slice(0, 7)}) for macOS (Apple silicon). The app is signed with a Developer ID and notarized by Apple. Installed copies update themselves once this release is published; to install by hand, open the DMG and drag BB Studio to Applications.`,
    "",
  ];
  if (since !== null) {
    const previousTip = desktopTipAt(since);
    const before = new Set(forkSubjects(previousTip));
    const desktop = forkSubjects(desktopTip).filter(
      (subject) => !before.has(subject),
    );
    const section = (title, items) => {
      if (items.length === 0) return;
      lines.push(`## ${title}`, "", ...items.map((item) => `- ${item}`), "");
    };
    section("Desktop", desktop.reverse());
    for (const [title, path] of [
      ["Plugins", "plugins"],
      ["iPhone", "ios"],
    ]) {
      section(
        title,
        git(
          monorepo,
          "log",
          "--no-merges",
          "--reverse",
          "--format=%s",
          `${since}..origin/main`,
          "--",
          path,
        )
          .split("\n")
          .filter(Boolean),
      );
    }
    const previousUpstream = upstreamOf(previousTip);
    if (previousUpstream.commit !== upstream.commit) {
      const count = git(
        root,
        "rev-list",
        "--count",
        `${previousUpstream.commit}..${upstream.commit}`,
      );
      section("bb", [
        `Synced from bb ${previousUpstream.version} @ ${previousUpstream.commit.slice(0, 7)} to bb ${upstream.version} @ ${upstream.commit.slice(0, 7)} (${count} upstream commits).`,
      ]);
    }
  } else {
    lines.push("## Changes", "", "- (write the changes here)", "");
  }
  lines.push(
    "BB Studio is built on bb (https://github.com/get-bb/bb) by Michael Yong, used under the MIT License.",
    "",
  );
  return lines.join("\n");
}

function blockmapBuilder(desktopDir) {
  const require = createRequire(join(desktopDir, "package.json"));
  const builderPackage = require.resolve("electron-builder/package.json");
  const libRequire = createRequire(builderPackage);
  return libRequire(
    libRequire.resolve("app-builder-lib/out/targets/blockmap/blockmap"),
  );
}

function sha512(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

function readPlistValue(plist, key) {
  return run(
    root,
    "/usr/libexec/PlistBuddy",
    ["-c", `Print ${key}`, plist],
    { capture: true },
  ).stdout.trim();
}

function yamlFile(update) {
  const files = update.files
    .map(
      (file) =>
        `  - url: ${file.url}\n    sha512: ${file.sha512}\n    size: ${file.size}`,
    )
    .join("\n");
  return `version: ${update.version}\nfiles:\n${files}\npath: ${update.path}\nsha512: ${update.sha512}\nreleaseDate: '${update.releaseDate}'\nminimumSystemVersion: 22.0.0\n`;
}

function remoteFor(repo) {
  const remotes = git(monorepo, "remote").split("\n").filter(Boolean);
  for (const remote of remotes) {
    const url = git(monorepo, "remote", "get-url", remote);
    const slug = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1];
    if (slug === repo) return remote;
  }
  return null;
}

function preflight() {
  step("Checks");
  if (git(root, "rev-parse", "--show-prefix") !== "") {
    fail("run it in the desktop worktree, not in main's desktop/");
  }
  if (git(root, "rev-parse", "--abbrev-ref", "HEAD") !== "desktop") {
    fail("the desktop worktree must have the desktop branch checked out");
  }
  if (!existsSync(join(monorepo, "scripts/import-desktop.mjs"))) {
    fail(`no monorepo at ${monorepo} (set BB_STUDIO_MONOREPO)`);
  }
  run(root, "git", ["fetch", "--quiet", "origin"]);
  const local = git(root, "rev-parse", "desktop");
  const remote = git(root, "rev-parse", "origin/desktop");
  if (local !== remote) fail("desktop differs from origin/desktop: push or pull first");
  const mainDesktop = git(monorepo, "rev-parse", "origin/main:desktop");
  if (mainDesktop !== git(root, "rev-parse", "desktop^{tree}")) {
    fail("origin/main:desktop is not the desktop tree: import and push main first");
  }
  if (!existsSync(join(root, "apps/desktop/studio-upstream.json"))) {
    fail("apps/desktop/studio-upstream.json is missing: the generated commits are not at the tip");
  }
  const signs =
    !flag("--notes-only") &&
    !BUILD_ONLY &&
    option("--version", null) === null &&
    option("--bump", null) === null;
  if (signs && DRY) {
    plan("security show-keychain-info login.keychain-db (fail if locked)");
    plan("security find-identity -v -p codesigning (fail if CSC_NAME is not listed)");
    plan(
      NOTARY_KEY === null
        ? `no notary API key: notarytool keychain profile ${PROFILE}`
        : `notary API key from ${NOTARY_KEY.source}: check the key file exists`,
    );
  }
  if (!DRY && signs) {
    const keychain = run(
      root,
      "security",
      ["show-keychain-info", "login.keychain-db"],
      { capture: true, allowFailure: true },
    );
    const identities = run(
      root,
      "security",
      ["find-identity", "-v", "-p", "codesigning"],
      { capture: true, allowFailure: true },
    ).stdout ?? "";
    const problem = keychainProblem({
      keychainStatus: keychain.status,
      identities,
      cscName: process.env.CSC_NAME?.trim() ?? "",
    });
    if (problem !== null) fail(problem);
    if (NOTARY_KEY !== null && !existsSync(NOTARY_KEY.keyPath)) {
      fail(`the notary API key file from ${NOTARY_KEY.source} does not exist`);
    }
  }
  const auth = run(root, "gh", ["auth", "status"], {
    capture: true,
    allowFailure: true,
  });
  if (auth.status !== 0) fail("gh is not signed in");
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) fail("--repo must be owner/name");
  if (signs && remoteFor(REPO) === null) {
    fail(`the monorepo has no git remote for ${REPO}: add one (and allow it in the pre-push hook) before releasing there`);
  }
  console.log("  desktop matches origin/desktop and origin/main:desktop");
}

function bump(current, next) {
  step(`Bump ${current} -> ${next} on the stack`);
  const tip = git(root, "rev-parse", "desktop");
  const hand = handTip(tip);
  const base = git(root, "merge-base", tip, "upstream/main");
  const owner = git(
    root,
    "log",
    "--format=%s",
    "-1",
    `${base}..${hand}`,
    "--",
    VERSION_FILE,
  );
  if (owner === "") fail(`no commit owns ${VERSION_FILE}`);
  if (DRY) {
    plan(`fold version ${next} into "${owner}" under the ${generatedCount(tip)} generated commits, sync.mjs --source desktop-release-work --onto ${base.slice(0, 10)} --candidate desktop-candidate --checks none`);
    return;
  }
  const folded = foldVersion({
    repo: root,
    tip,
    base,
    owner,
    versionFile: VERSION_FILE,
    version: next,
    work: join(syncRoot, `release-bump-${next}`),
    branch: "desktop-release-work",
    coauthor: COAUTHOR,
    env: childEnv(),
  });
  const problems = bumpProblems({
    repo: root,
    tip,
    folded,
    versionFile: VERSION_FILE,
    generated: generatedCount(tip),
  });
  if (problems.length > 0) fail(problems.join("\n"));
  run(root, process.execPath, [
    "scripts/fork/sync.mjs",
    "--source",
    "desktop-release-work",
    "--onto",
    base,
    "--candidate",
    "desktop-candidate",
    "--checks",
    "none",
  ]);
  const changed = git(root, "diff", "--name-only", "desktop", "desktop-candidate")
    .split("\n")
    .filter(Boolean);
  if (changed.length !== 1 || changed[0] !== VERSION_FILE) {
    fail(`desktop-candidate differs from desktop in more than the version: ${changed.join(", ")}`);
  }
  console.log(`
desktop-candidate has version ${next}. Promote and publish the branch as usual:
  git fetch origin && test "$(git rev-parse desktop)" = "$(git rev-parse origin/desktop)"
  git reset --hard desktop-candidate
  node scripts/fork/check-core-diff.mjs
  (cd ${monorepo} && node scripts/import-desktop.mjs && node scripts/import-desktop.mjs --check)
  (cd ${monorepo} && git push origin main) && git push --force-with-lease=desktop:${tip} origin desktop
Then run: node scripts/fork/release-desktop.mjs --no-bump`);
}

function build(dir, version) {
  step(`Build ${version} in ${dir}`);
  const desktop = join(dir, "apps/desktop");
  if (DRY) {
    plan(`git worktree add --detach ${dir} desktop`);
    plan("pnpm install --frozen-lockfile && pnpm build");
    plan("apps/desktop: pnpm run prepare-runtime && pnpm run build");
    plan(`git archive origin/main plugins into ${dir}-plugins, pnpm install --frozen-lockfile there, bundle-studio-plugins.mjs into bb-app's builtin-plugins`);
    plan("apps/desktop: node scripts/run-electron-builder.mjs --mac --arm64 --publish never (CSC_NAME)");
    return;
  }
  if (existsSync(dir)) {
    const head = git(dir, "rev-parse", "HEAD");
    if (head !== git(root, "rev-parse", "desktop")) {
      fail(`${dir} exists at another commit: remove it (git worktree remove --force ${dir})`);
    }
  } else {
    run(root, "git", ["worktree", "add", "--quiet", "--detach", dir, "desktop"]);
  }
  run(dir, "pnpm", ["install", "--frozen-lockfile"]);
  run(dir, "pnpm", ["build"]);
  run(desktop, "pnpm", ["run", "prepare-runtime"]);
  run(desktop, "pnpm", ["run", "build"]);
  bundleStudioPlugins(dir);
  rmSync(join(desktop, "release"), { recursive: true, force: true });
  run(desktop, process.execPath, [
    "scripts/run-electron-builder.mjs",
    "--mac",
    "--arm64",
    "--publish",
    "never",
  ]);
  run(dir, "git", ["checkout", "--", "apps/web/src/routeTree.gen.ts"], {
    allowFailure: true,
  });
}

function bundleStudioPlugins(dir) {
  const target = git(monorepo, "rev-parse", "origin/main");
  const work = `${dir}-plugins`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const archive = spawnSync(
    "sh",
    ["-c", 'git archive "$1" plugins | tar -x -C "$2"', "sh", target, work],
    { cwd: monorepo, stdio: "inherit" },
  );
  if (archive.status !== 0) fail("git archive of plugins/ failed");
  run(join(work, "plugins"), "pnpm", ["install", "--frozen-lockfile"]);
  run(dir, process.execPath, [
    "scripts/fork/bundle-studio-plugins.mjs",
    "--packages",
    join(work, "plugins", "packages"),
    "--out",
    join(dir, "packages", "bb-app", "server", "dist", "builtin-plugins"),
  ]);
  console.log(`  bundled Studio and Visual Chat from origin/main ${target.slice(0, 10)}`);
}

function releaseFiles(desktop, version) {
  const release = join(desktop, "release");
  const app = join(release, "mac-arm64", "BB Studio.app");
  const named = (ext) => join(release, `BB-Studio-${version}-arm64.${ext}`);
  return {
    release,
    app,
    dmg: named("dmg"),
    zip: named("zip"),
    latest: join(release, "latest-mac.yml"),
    versionFeed: join(release, "desktop-version.json"),
  };
}

function verifyApp(files, version) {
  const plist = join(files.app, "Contents/Info.plist");
  const shortVersion = readPlistValue(plist, "CFBundleShortVersionString");
  const bundleId = readPlistValue(plist, "CFBundleIdentifier");
  if (shortVersion !== version) fail(`the app reports ${shortVersion}, not ${version}`);
  if (bundleId !== "nyc.plee.bbstudio") fail(`the app id is ${bundleId}`);
  const updateConfig = readFileSync(
    join(files.app, "Contents/Resources/app-update.yml"),
    "utf8",
  );
  const feed = parseStudioRelease(
    git(root, "show", `desktop:${VERSION_FILE}`),
  ).updates;
  for (const line of [
    "provider: github",
    `owner: ${feed.owner}`,
    `repo: ${feed.repo}`,
    "updaterCacheDirName: bb-studio-desktop-updater",
  ]) {
    if (!updateConfig.includes(line)) fail(`app-update.yml lacks "${line}"`);
  }
  if (existsSync(join(files.app, "Contents/Resources/desktop-control"))) {
    fail("the app bundles desktop control (Contents/Resources/desktop-control): the HUD does not ship yet");
  }
  console.log(`  BB Studio.app is ${version}, ${bundleId}, feed github ${feed.owner}/${feed.repo}, no desktop control`);
}

function sign(files, version) {
  step("Sign, notarize and staple");
  if (DRY) {
    plan("codesign the DMG with CSC_NAME");
    plan(
      `xcrun ${maskArgs(notaryArgs("<dmg>", NOTARY_KEY, PROFILE), NOTARY_KEY).join(" ")}${
        NOTARY_KEY === null ? "" : ` (API key from ${NOTARY_KEY.source})`
      }`,
    );
    plan("xcrun stapler staple <dmg> and BB Studio.app; ditto the stapled app into the zip");
    plan("rebuild both blockmaps, latest-mac.yml and desktop-version.json");
    return;
  }
  for (const file of [files.app, files.dmg]) {
    if (!existsSync(file)) fail(`${file} is missing: run the build step`);
  }
  verifyApp(files, version);
  run(root, "codesign", ["--verify", "--deep", "--strict", files.app]);
  const stapled = spawnSync("xcrun", ["stapler", "validate", files.dmg], {
    encoding: "utf8",
  });
  if (stapled.status !== 0) {
    const name = process.env.CSC_NAME.trim();
    run(root, "codesign", ["--force", "--sign", name, "--timestamp", files.dmg]);
    const submit = run(root, "xcrun", notaryArgs(files.dmg, NOTARY_KEY, PROFILE), {
      capture: true,
      allowFailure: true,
    });
    process.stdout.write(maskArgs([submit.stdout ?? ""], NOTARY_KEY)[0]);
    if (submit.status !== 0 || !/status: Accepted/.test(submit.stdout ?? "")) {
      process.stderr.write(maskArgs([submit.stderr ?? ""], NOTARY_KEY)[0]);
      fail(
        NOTARY_KEY === null
          ? "notarization was not accepted (if the keychain profile could not be read, the Mac may be locked)"
          : "notarization was not accepted",
      );
    }
    run(root, "xcrun", ["stapler", "staple", files.dmg]);
  }
  run(root, "xcrun", ["stapler", "staple", files.app]);
  run(root, "xcrun", ["stapler", "validate", files.app]);
  run(root, "spctl", ["-a", "-t", "open", "--context", "context:primary-signature", "-v", files.dmg]);
  run(root, "spctl", ["-a", "-v", files.app]);

  step("Zip, blockmaps and update feed");
  rmSync(files.zip, { force: true });
  rmSync(`${files.zip}.blockmap`, { force: true });
  run(files.release, "ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    files.app,
    files.zip,
  ]);
}

async function feed(files, version) {
  if (DRY) return;
  const { buildBlockMap } = blockmapBuilder(dirname(files.release));
  const entries = [];
  for (const file of [files.zip, files.dmg]) {
    rmSync(`${file}.blockmap`, { force: true });
    await buildBlockMap(file, "gzip", `${file}.blockmap`);
    entries.push({
      url: basename(file),
      sha512: sha512(file),
      size: statSync(file).size,
    });
  }
  const releaseDate = new Date().toISOString();
  const update = {
    version,
    files: entries,
    path: entries[0].url,
    sha512: entries[0].sha512,
    releaseDate,
  };
  writeFileSync(files.latest, yamlFile(update));
  writeFileSync(
    files.versionFeed,
    `${JSON.stringify(
      {
        channel: "latest",
        files: entries,
        minimumSystemVersion: "22.0.0",
        path: update.path,
        platform: "macos",
        releaseDate,
        releaseName: `BB Studio desktop ${version}`,
        releaseNotes: null,
        schemaVersion: 1,
        sha512: update.sha512,
        stagingPercentage: null,
        version,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  ${basename(files.latest)}: ${entries.map((entry) => `${entry.url} ${entry.size}`).join(", ")}`);
}

function publish(files, version, notesPath, dir) {
  step(`Tag v${version} and draft the release on ${REPO}`);
  const tag = `v${version}`;
  run(monorepo, "git", ["fetch", "--quiet", "origin", "main", "--tags"]);
  const target = git(monorepo, "rev-parse", "origin/main");
  const built = DRY ? "desktop" : git(dir, "rev-parse", "HEAD");
  if (git(monorepo, "rev-parse", `${target}:desktop`) !== git(root, "rev-parse", `${built}^{tree}`)) {
    fail("origin/main:desktop is not the tree that was built");
  }
  const assets = [
    files.dmg,
    `${files.dmg}.blockmap`,
    files.zip,
    `${files.zip}.blockmap`,
    files.latest,
    files.versionFeed,
  ];
  if (DRY) {
    plan(`git tag -a ${tag} ${target.slice(0, 10)} && git push ${remoteFor(REPO)} refs/tags/${tag}`);
    plan(`gh release create ${tag} --repo ${REPO} --draft --verify-tag --title "BB Studio ${version}" --notes-file ${notesPath} <dmg, zip, blockmaps, latest-mac.yml, desktop-version.json>`);
    return;
  }
  for (const asset of assets) if (!existsSync(asset)) fail(`${asset} is missing`);
  const existing = tryGit(monorepo, "rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`);
  if (existing.status === 0) {
    if (existing.stdout.trim() !== target) {
      fail(`${tag} already exists at ${existing.stdout.trim().slice(0, 10)}, not origin/main`);
    }
  } else {
    run(monorepo, "git", ["tag", "-a", tag, target, "-m", `BB Studio ${version}`]);
  }
  run(monorepo, "git", ["push", remoteFor(REPO), `refs/tags/${tag}`]);

  const view = run(
    monorepo,
    "gh",
    ["release", "view", tag, "--repo", REPO, "--json", "isDraft,url"],
    { capture: true, allowFailure: true },
  );
  if (view.status === 0) {
    if (!JSON.parse(view.stdout).isDraft) fail(`${tag} is already published`);
    run(monorepo, "gh", [
      "release",
      "edit",
      tag,
      "--repo",
      REPO,
      "--title",
      `BB Studio ${version}`,
      "--notes-file",
      notesPath,
    ]);
    run(monorepo, "gh", ["release", "upload", tag, "--repo", REPO, "--clobber", ...assets]);
  } else {
    run(monorepo, "gh", [
      "release",
      "create",
      tag,
      "--repo",
      REPO,
      "--draft",
      "--verify-tag",
      "--title",
      `BB Studio ${version}`,
      "--notes-file",
      notesPath,
      ...assets,
    ]);
  }
  const url = JSON.parse(
    run(monorepo, "gh", ["release", "view", tag, "--repo", REPO, "--json", "url"], {
      capture: true,
    }).stdout,
  ).url;
  const visibility = JSON.parse(
    run(monorepo, "gh", ["repo", "view", REPO, "--json", "visibility"], {
      capture: true,
    }).stdout,
  ).visibility;
  console.log(`\nDraft: ${url}`);
  if (visibility !== "PUBLIC") {
    console.log(
      `${REPO} is ${visibility.toLowerCase()}: installed apps never read it; their feed is the one in ${VERSION_FILE}.`,
    );
  } else {
    console.log("Publishing this draft makes it the update for installed copies whose feed is this repository.");
  }
}

async function main() {
  preflight();
  const current = parseStudioRelease(
    git(root, "show", `desktop:${VERSION_FILE}`),
  ).version;
  const explicit = option("--version", null);
  const bumpKind = option("--bump", null);
  if (!flag("--no-bump") && explicit === null && bumpKind === null) {
    fail("choose --bump patch|minor|major, --version x.y.z or --no-bump");
  }
  if (explicit !== null || bumpKind !== null) {
    const next =
      explicit !== null
        ? assertStudioVersion(explicit, "--version")
        : bumpVersion(current, bumpKind);
    if (compareVersions(next, current) <= 0) {
      fail(`${next} is not higher than ${current}`);
    }
    bump(current, next);
    return;
  }

  const version = current;
  if (BUILD_ONLY) {
    const dir = join(syncRoot, `build-v${version}`);
    const files = releaseFiles(join(dir, "apps/desktop"), version);
    build(dir, version);
    if (!DRY) console.log(`\nBuilt ${files.app}\n  and ${files.dmg}`);
    return;
  }
  const tags = studioTags();
  const since = option("--since", null) ?? tags.filter((tag) => tag !== `v${version}`).at(-1) ?? null;
  const published = tags.includes(`v${version}`)
    ? run(
        monorepo,
        "gh",
        ["release", "view", `v${version}`, "--repo", REPO, "--json", "isDraft"],
        { capture: true, allowFailure: true },
      )
    : null;
  if (published?.status === 0 && !JSON.parse(published.stdout).isDraft) {
    fail(`v${version} is already published: bump first`);
  }
  console.log(`  version ${version}${since === null ? "" : `, notes since ${since}`}`);

  mkdirSync(syncRoot, { recursive: true });
  let notesPath = option("--notes", null);
  if (notesPath === null) {
    notesPath = join(syncRoot, `release-notes-v${version}.md`);
    writeFileSync(
      notesPath,
      draftNotes({
        version,
        since,
        desktopTip: git(root, "rev-parse", "desktop"),
      }),
    );
    console.log(`  notes drafted: ${notesPath}`);
  } else {
    notesPath = resolve(notesPath);
    if (!existsSync(notesPath)) fail(`${notesPath} does not exist`);
    if (!readFileSync(notesPath, "utf8").startsWith(`BB Studio ${version} `)) {
      fail(`the notes must start with "BB Studio ${version} "`);
    }
  }
  if (flag("--notes-only")) return;

  const dir = join(syncRoot, `release-v${version}`);
  const files = releaseFiles(join(dir, "apps/desktop"), version);
  const from = STEPS.indexOf(FROM);
  if (from <= 0) build(dir, version);
  if (from <= 1) {
    sign(files, version);
    await feed(files, version);
  }
  publish(files, version, notesPath, dir);
  if (DRY) console.log("\nDry run: nothing was built, tagged, pushed or uploaded.");
  else if (readdirSync(files.release).length > 0) {
    console.log(`Artifacts: ${files.release}`);
  }
}

await main();
