import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach } from "vitest";

interface SkipEntry {
  file: string;
  title: string;
}

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const list = JSON.parse(
  readFileSync(path.join(root, "scripts/fork/skipped-tests.json"), "utf8"),
) as { skip: SkipEntry[]; skipEach?: SkipEntry[] };

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function templatePattern(title: string): RegExp {
  const pattern = escapeRegExp(title)
    .replace(/%[sdifjoO#]/g, ".*")
    .replace(/\\\$[A-Za-z_][\w.]*/g, ".*");
  return new RegExp(`^${pattern}$`, "s");
}

const byFile = new Map<string, { titles: Set<string>; patterns: RegExp[] }>();
const entryFor = (file: string) => {
  const existing = byFile.get(file);
  if (existing !== undefined) return existing;
  const created = { titles: new Set<string>(), patterns: [] as RegExp[] };
  byFile.set(file, created);
  return created;
};
for (const { file, title } of list.skip) entryFor(file).titles.add(title);
for (const { file, title } of list.skipEach ?? []) {
  entryFor(file).patterns.push(templatePattern(title));
}

beforeEach(({ task, skip }) => {
  const filepath = task.file?.filepath;
  if (filepath === undefined) return;
  const entry = byFile.get(
    path.relative(root, filepath).split(path.sep).join("/"),
  );
  if (entry === undefined) return;
  if (
    entry.titles.has(task.name) ||
    entry.patterns.some((each) => each.test(task.name))
  ) {
    skip();
  }
});
