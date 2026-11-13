import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SWITCH_ON_TELEMETRY = /checked=\{[^}]*telemetry[^}]*\}/i;
const SEARCH_ENTRY = /"telemetry"|usage data/i;

export function telemetrySwitchProblems(files) {
  const problems = [];
  for (const { path, text } of files) {
    if (SWITCH_ON_TELEMETRY.test(text)) {
      problems.push(`${path}: a switch is bound to a telemetry setting`);
    }
    if (
      path.endsWith("settings/settings-search.ts") &&
      SEARCH_ENTRY.test(text)
    ) {
      problems.push(
        `${path}: settings search still lists a usage data setting`,
      );
    }
  }
  return problems;
}

export function appTelemetryFiles(root) {
  const grep = spawnSync(
    "git",
    [
      "grep",
      "-l",
      "-i",
      "-E",
      "telemetry|usage data",
      "--",
      "apps/app/src",
      ":!*.test.*",
      ":!*.stories.*",
    ],
    { cwd: root, encoding: "utf8" },
  );
  return grep.stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));
}
