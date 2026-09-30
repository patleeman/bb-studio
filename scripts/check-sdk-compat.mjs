#!/usr/bin/env node

/**
 * Check that every plugin installs on the current stable BB release.
 *
 * npm's `latest` tag for @get-bb/plugin-sdk tracks BB Nightly, so installing
 * the SDK or scaffolding a plugin pins a version stable BB does not ship yet.
 * Stable BB then refuses the plugin because `engines.bbPluginSdk` is above its
 * bundled SDK. This script reads the stable release feed, looks up the SDK
 * version bundled in that release, and fails when any plugin:
 *
 *   - declares an `engines.bb` range the stable release does not satisfy,
 *   - declares an `engines.bbPluginSdk` range the stable SDK does not satisfy
 *     (using BB's floor semantics, see sdk-compat.ts in get-bb/bb), or
 *   - depends on @get-bb/plugin-sdk with anything but an exact version at or
 *     below the stable SDK, so typechecking cannot use nightly-only APIs.
 *
 * Usage:
 *   node scripts/check-sdk-compat.mjs
 *
 * Set BB_STABLE_VERSION and BB_STABLE_SDK_VERSION to check offline or against
 * a specific release.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseFeedUrl = "https://github.com/get-bb/bb/releases/download/desktop-latest/latest-mac.yml";
const sdkManifestUrl = (bbVersion) =>
  `https://raw.githubusercontent.com/get-bb/bb/desktop-v${bbVersion}/packages/plugin-sdk/package.json`;
const sdkPackage = "@get-bb/plugin-sdk";

// Minimal semver for the range syntax plugin manifests use: `||`, comparator
// sets, `>= > <= < =`, `^`, `~`, partial versions, and x-ranges. Anything else
// throws so an unsupported range fails loudly instead of passing.

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (!match) throw new Error(`not a release version: ${JSON.stringify(text)}`);
  return match.slice(1).map(Number);
}

function compare(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function parsePartial(text) {
  const match = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(text);
  if (!match) throw new Error(`unsupported version ${JSON.stringify(text)}`);
  const parts = [];
  for (const part of match.slice(1)) {
    if (part === undefined || /^[xX*]$/.test(part)) break;
    parts.push(Number(part));
  }
  return parts;
}

function comparators(token) {
  const match = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token);
  const op = match[1] ?? "=";
  const parts = parsePartial(match[2]);
  if (parts.length === 0) return op === "<" || op === ">" ? [["<", [0, 0, 0]]] : [];
  const [major, minor, patch] = parts;
  const lower = [major, minor ?? 0, patch ?? 0];
  const full = parts.length === 3;
  const bumped = minor === undefined ? [major + 1, 0, 0] : [major, minor + 1, 0];
  switch (op) {
    case "=":
      return full ? [["=", lower]] : [[">=", lower], ["<", bumped]];
    case ">=":
      return [[">=", lower]];
    case ">":
      return [full ? [">", lower] : [">=", bumped]];
    case "<":
      return [["<", lower]];
    case "<=":
      return [full ? ["<=", lower] : ["<", bumped]];
    case "~":
      return [[">=", lower], ["<", bumped]];
    case "^": {
      let upper;
      if (major > 0 || minor === undefined) upper = [major + 1, 0, 0];
      else if (minor > 0 || patch === undefined) upper = [0, minor + 1, 0];
      else upper = [0, 0, patch + 1];
      return [[">=", lower], ["<", upper]];
    }
  }
  throw new Error(`unsupported operator ${op}`);
}

function parseRange(range) {
  return range.split("||").map((set) => {
    const normalized = set.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1");
    if (/\s-\s/.test(set)) throw new Error(`hyphen ranges are not supported: ${JSON.stringify(range)}`);
    return normalized === "" ? [] : normalized.split(/\s+/).flatMap(comparators);
  });
}

function satisfies(version, range) {
  return parseRange(range).some((set) =>
    set.every(([op, bound]) => {
      const order = compare(version, bound);
      if (op === "=") return order === 0;
      if (op === ">=") return order >= 0;
      if (op === ">") return order > 0;
      if (op === "<=") return order <= 0;
      return order < 0;
    }),
  );
}

function minVersion(range) {
  const floors = parseRange(range).map((set) => {
    let floor = [0, 0, 0];
    for (const [op, bound] of set) {
      const candidate = op === ">" ? [bound[0], bound[1], bound[2] + 1] : bound;
      if ((op === ">=" || op === ">" || op === "=") && compare(candidate, floor) > 0) floor = candidate;
    }
    return floor;
  });
  return floors.reduce((lowest, floor) => (compare(floor, lowest) < 0 ? floor : lowest));
}

// Mirrors isPluginSdkRangeSatisfied in BB: the range's floor is honored within
// the running SDK's major version even when the range has a ceiling.
function sdkRangeSatisfied(sdkVersion, range) {
  if (satisfies(sdkVersion, range)) return true;
  const floor = minVersion(range);
  return floor[0] === sdkVersion[0] && compare(sdkVersion, floor) >= 0;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.text();
}

async function stableVersions() {
  let bb = process.env.BB_STABLE_VERSION;
  let sdk = process.env.BB_STABLE_SDK_VERSION;
  if (!bb) {
    const feed = await fetchText(releaseFeedUrl);
    bb = /^version:\s*(\S+)\s*$/m.exec(feed)?.[1];
    if (!bb) throw new Error(`no version in ${releaseFeedUrl}`);
  }
  if (!sdk) sdk = JSON.parse(await fetchText(sdkManifestUrl(bb))).version;
  return { bb, sdk };
}

async function readPlugins() {
  const packagesDir = join(repoRoot, "packages");
  const plugins = [];
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(packagesDir, entry.name, "package.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (manifest.bb) plugins.push({ dir: `packages/${entry.name}`, manifest });
  }
  return plugins.sort((a, b) => a.dir.localeCompare(b.dir));
}

function checkPlugin({ manifest }, stable) {
  const problems = [];
  const bbVersion = parseVersion(stable.bb);
  const sdkVersion = parseVersion(stable.sdk);
  const engines = manifest.engines ?? {};

  if (engines.bb !== undefined && !satisfies(bbVersion, engines.bb)) {
    problems.push(`engines.bb ${JSON.stringify(engines.bb)} excludes stable bb ${stable.bb}`);
  }
  if (engines.bbPluginSdk !== undefined && !sdkRangeSatisfied(sdkVersion, engines.bbPluginSdk)) {
    problems.push(
      `engines.bbPluginSdk ${JSON.stringify(engines.bbPluginSdk)} excludes stable SDK ${stable.sdk}; ` +
        `use ">=${stable.sdk}" or lower`,
    );
  }
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const spec = manifest[field]?.[sdkPackage];
    if (spec === undefined) continue;
    if (!/^\d+\.\d+\.\d+$/.test(spec)) {
      problems.push(`${field} pins ${sdkPackage} to ${JSON.stringify(spec)}; use an exact version, at most ${stable.sdk}`);
    } else if (compare(parseVersion(spec), sdkVersion) > 0) {
      problems.push(`${field} uses ${sdkPackage}@${spec}, newer than stable SDK ${stable.sdk}`);
    }
  }
  return problems;
}

const stable = await stableVersions();
const plugins = await readPlugins();
console.log(`Stable bb ${stable.bb} ships ${sdkPackage}@${stable.sdk}\n`);

let failures = 0;
for (const plugin of plugins) {
  const problems = checkPlugin(plugin, stable);
  if (problems.length === 0) {
    console.log(`ok    ${plugin.dir}`);
    continue;
  }
  failures += 1;
  console.log(`FAIL  ${plugin.dir}`);
  for (const problem of problems) console.log(`      - ${problem}`);
}

if (failures > 0) {
  console.log(
    `\n${failures} plugin(s) would not install on stable bb ${stable.bb}. ` +
      `Pin ${sdkPackage} to ${stable.sdk} or lower and keep engines at or below the stable release.`,
  );
  process.exit(1);
}
console.log(`\nAll ${plugins.length} plugins are compatible with stable bb ${stable.bb}.`);
