#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const removed = JSON.parse(
  readFileSync(resolve(root, "scripts/fork/removed-plugins.json"), "utf8"),
);
const dirs = new Set(removed.map((plugin) => plugin.dir));
const packages = new Set(removed.map((plugin) => plugin.package));
const pluginIds = new Set(removed.map((plugin) => plugin.pluginId));
const skipInstall = process.argv.includes("--no-install");

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function editJson(relativePath, edit) {
  const file = resolve(root, relativePath);
  if (!existsSync(file)) return;
  const before = readFileSync(file, "utf8");
  const value = JSON.parse(before);
  const after = `${JSON.stringify(edit(value) ?? value, null, 2)}\n`;
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`edited ${relativePath}`);
  }
}

function dropDependencies(manifest) {
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (packages.has(name)) delete manifest[field][name];
    }
  }
}

function removeTaskBlocks(text) {
  let output = text;
  for (const name of packages) {
    for (;;) {
      const start = output.search(
        new RegExp(`^[ \\t]*"${name.replace(/[-]/g, "\\-")}#[^"]+": \\{`, "m"),
      );
      if (start === -1) break;
      let index = output.indexOf("{", start);
      let depth = 0;
      for (; index < output.length; index += 1) {
        if (output[index] === "{") depth += 1;
        if (output[index] === "}") depth -= 1;
        if (depth === 0) break;
      }
      let end = index + 1;
      if (output[end] === ",") end += 1;
      if (output[end] === "\n") end += 1;
      output = output.slice(0, start) + output.slice(end);
    }
  }
  return output;
}

for (const dir of dirs) {
  const relativePath = `plugins/${dir}`;
  if (git("ls-files", "--", relativePath).length > 0) {
    git("rm", "-r", "-q", "--", relativePath);
    console.log(`removed ${relativePath}`);
  }
  rmSync(resolve(root, relativePath), { recursive: true, force: true });
  const feature = `.bb/skills/verify-bb/features/plugin-${dir}.md`;
  if (git("ls-files", "--", feature).length > 0) {
    git("rm", "-q", "--", feature);
    console.log(`removed ${feature}`);
  }
}

for (const manifest of git("ls-files", "--", "*package.json")
  .split("\n")
  .filter(Boolean)) {
  editJson(manifest, dropDependencies);
}

editJson("plugins/bb-official.json", (catalog) => {
  for (const dir of dirs) delete catalog[dir];
});

editJson("scripts/forkable-plugins.json", (value) => {
  const keep = (entry) =>
    typeof entry !== "string" || !dirs.has(entry.replace(/^plugins\//, ""));
  if (Array.isArray(value)) return value.filter(keep);
  for (const key of Object.keys(value)) {
    if (Array.isArray(value[key])) value[key] = value[key].filter(keep);
  }
});

editJson("plugins/plugin-api-docs/src/first-party-plugins.json", (rows) =>
  rows.filter((row) => !pluginIds.has(row.id)),
);

const turboPath = resolve(root, "turbo.json");
const turboBefore = readFileSync(turboPath, "utf8");
const turboAfter = removeTaskBlocks(turboBefore)
  .split("\n")
  .filter(
    (line) =>
      ![...dirs].some((dir) => line.includes(`$TURBO_ROOT$/plugins/${dir}/`)),
  )
  .join("\n");
if (turboAfter !== turboBefore) {
  writeFileSync(turboPath, turboAfter);
  console.log("edited turbo.json");
}

const testEdits = JSON.parse(
  readFileSync(resolve(root, "scripts/fork/skipped-tests.json"), "utf8"),
);
let missingTestEdits = 0;
for (const { file, line } of testEdits.removeLines) {
  const path = resolve(root, file);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = before
    .split("\n")
    .filter((candidate) => candidate.trim() !== line)
    .join("\n");
  if (after !== before) {
    writeFileSync(path, after);
    console.log(`removed a line from ${file}`);
  }
}
const unregisterPatch = "scripts/fork/patches/unregister.patch";
const extraFiles = [
  "apps/app/src/components/plugin/theme-preview-fixture-anatomy.test.ts",
  "apps/server/test/connect-next/tunnel-ingress.test.ts",
];
for (const file of extraFiles) {
  if (existsSync(resolve(root, file))) {
    rmSync(resolve(root, file));
    console.log(`removed ${file}`);
  }
}
const patchApplies = (...flags) => {
  try {
    execFileSync("git", ["apply", "--check", ...flags, unregisterPatch], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};
if (patchApplies("-R")) {
  console.log("unregister patch already applied");
} else if (patchApplies()) {
  execFileSync("git", ["apply", unregisterPatch], { cwd: root });
  console.log("applied unregister patch");
} else {
  missingTestEdits += 1;
  console.error(
    `NOT APPLIED ${unregisterPatch}: an upstream change moved the lines it edits. Apply it by hand with "git apply --3way", fix the result, then regenerate the patch (see STUDIO_FORK.md).`,
  );
}
if (missingTestEdits > 0) process.exitCode = 1;

if (!skipInstall) {
  execFileSync("pnpm", ["install", "--no-frozen-lockfile"], {
    cwd: root,
    stdio: "inherit",
  });
}
