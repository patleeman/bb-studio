import { spawnSync } from "node:child_process";

const DESCRIBED = /^desktop-v(.+)-(\d+)-g[0-9a-f]+$/;

export function parseUpstreamDescribe(described) {
  const match = DESCRIBED.exec(described.trim());
  return match === null ? null : { version: match[1], ahead: Number(match[2]) };
}

export function describeUpstreamBase(root, commit) {
  const described = spawnSync(
    "git",
    ["describe", "--tags", "--long", "--match", "desktop-v[0-9]*", commit],
    { cwd: root, encoding: "utf8" },
  );
  if (described.status !== 0) return null;
  const parsed = parseUpstreamDescribe(described.stdout);
  return parsed === null
    ? null
    : { version: parsed.version, commit, ahead: parsed.ahead };
}
