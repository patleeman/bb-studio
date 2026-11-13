#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktop = join(root, "apps", "desktop");
export const MANIFEST_PATH = join(desktop, "desktop-control.fork.json");
export const DEFAULT_OUT = join(desktop, "release", "desktop-control");
export const DEFAULT_CACHE = join(desktop, "release", ".desktop-control-cache");
export const HELPER_SOURCE = join(
  desktop,
  "native",
  "fork-desktop-helper",
  "main.swift",
);
export const NOTICE_SOURCE = join(
  desktop,
  "native",
  "desktop-control-NOTICE.md",
);

export function parseManifest(text) {
  const driver = JSON.parse(text).driver;
  for (const key of [
    "version",
    "repository",
    "tag",
    "commit",
    "asset",
    "sha256",
    "certificateIdentity",
    "oidcIssuer",
  ]) {
    if (typeof driver?.[key] !== "string" || driver[key].length === 0) {
      throw new Error(`desktop-control.fork.json: driver.${key} is missing`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(driver.sha256))
    throw new Error(
      "desktop-control.fork.json: driver.sha256 must be 64 hex digits",
    );
  if (!/^[0-9a-f]{40}$/.test(driver.commit))
    throw new Error(
      "desktop-control.fork.json: driver.commit must be a full sha",
    );
  if (!driver.repository.startsWith("https://github.com/"))
    throw new Error(
      "desktop-control.fork.json: driver.repository must be on GitHub",
    );
  return driver;
}

export function releaseUrl(driver, file) {
  return `${driver.repository}/releases/download/${driver.tag}/${file}`;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function download(url, path) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok)
    throw new Error(`download failed (${response.status}): ${url}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed`);
}

function has(command) {
  return (
    spawnSync("/usr/bin/which", [command], { stdio: "ignore" }).status === 0
  );
}

export async function stageDesktopControl({
  out = DEFAULT_OUT,
  cache = DEFAULT_CACHE,
  requireCosign = true,
  log = console.log,
} = {}) {
  if (process.platform !== "darwin")
    throw new Error("desktop control is built on macOS only");
  const driver = parseManifest(readFileSync(MANIFEST_PATH, "utf8"));
  mkdirSync(cache, { recursive: true });
  const asset = join(cache, driver.asset);
  const bundle = `${asset}.sigstore.json`;
  if (!existsSync(asset) || sha256(readFileSync(asset)) !== driver.sha256) {
    log(`desktop-control: downloading ${driver.asset}`);
    await download(releaseUrl(driver, driver.asset), asset);
  }
  if (!existsSync(bundle))
    await download(releaseUrl(driver, `${driver.asset}.sigstore.json`), bundle);
  const digest = sha256(readFileSync(asset));
  if (digest !== driver.sha256)
    throw new Error(
      `desktop-control: ${driver.asset} has sha256 ${digest}, expected ${driver.sha256}`,
    );
  log(`desktop-control: sha256 ok (${digest})`);
  if (has("cosign")) {
    run("cosign", [
      "verify-blob",
      "--bundle",
      bundle,
      "--certificate-identity",
      driver.certificateIdentity,
      "--certificate-oidc-issuer",
      driver.oidcIssuer,
      asset,
    ]);
    log("desktop-control: sigstore signature ok");
  } else if (requireCosign) {
    throw new Error(
      "desktop-control: cosign is needed to verify the driver's signature (brew install cosign), or pass --no-cosign for a local test",
    );
  } else {
    log("desktop-control: cosign not found; the signature was NOT verified");
  }
  const work = mkdtempSync(join(tmpdir(), "desktop-control-"));
  try {
    run("/usr/bin/tar", ["-xzf", asset, "-C", work, "cua-driver"]);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    copyFileSync(join(work, "cua-driver"), join(out, "cua-driver"));
    chmodSync(join(out, "cua-driver"), 0o755);
    const slices = [];
    for (const arch of ["arm64", "x86_64"]) {
      const slice = join(work, `helper-${arch}`);
      run("/usr/bin/xcrun", [
        "swiftc",
        "-O",
        "-target",
        `${arch}-apple-macos13`,
        HELPER_SOURCE,
        "-o",
        slice,
      ]);
      slices.push(slice);
    }
    run("/usr/bin/lipo", [
      "-create",
      ...slices,
      "-output",
      join(out, "bb-studio-desktop-helper"),
    ]);
    chmodSync(join(out, "bb-studio-desktop-helper"), 0o755);
    copyFileSync(NOTICE_SOURCE, join(out, "NOTICE.md"));
    writeFileSync(
      join(out, "driver.json"),
      `${JSON.stringify({ version: driver.version, tag: driver.tag, commit: driver.commit, sha256: driver.sha256 }, null, 2)}\n`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  log(`desktop-control: staged in ${out}`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  if (args.includes("--help")) {
    console.log(
      "node scripts/fork/desktop-control.mjs [--out <dir>] [--cache <dir>] [--no-cosign]\nDownloads the pinned Cua Driver release (apps/desktop/desktop-control.fork.json), checks its sha256 and sigstore signature, builds bb-studio-desktop-helper, and stages both with NOTICE.md for electron-builder (Contents/Resources/desktop-control).",
    );
    process.exit(0);
  }
  stageDesktopControl({
    out: value("--out") ?? DEFAULT_OUT,
    cache: value("--cache") ?? DEFAULT_CACHE,
    requireCosign: !args.includes("--no-cosign"),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
