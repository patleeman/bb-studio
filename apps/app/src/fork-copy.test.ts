import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const QUIP_PATTERNS: readonly RegExp[] = [
  /\bshared by\b/iu,
  /\blives in\b/iu,
  /\bso (?:you|that) can\b/iu,
  /\bread-only because\b/iu,
  /\bdon[’']t worry\b/iu,
  /\bno need to\b/iu,
  /\byou can (?:always|still|also)\b/iu,
  /\bwhich means\b/iu,
  /\bin other words\b/iu,
  /\bkeep in mind\b/iu,
  /\bthis (?:is|means) (?:where|how|that)\b/iu,
  /\bmay need to\b/iu,
  /\bon the machine that runs\b/iu,
  /\bnothing to (?:report|worry)\b/iu,
];

const STRING_LITERAL =
  /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/gu;
const JSX_TEXT = />([^<>{}]*[A-Za-z][^<>{}]*)</gu;

function findQuips(source: string): string[] {
  const texts: string[] = [];
  for (const match of source.matchAll(STRING_LITERAL)) {
    texts.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  for (const match of source.matchAll(JSX_TEXT)) {
    texts.push(match[1] ?? "");
  }
  return texts
    .map((text) => text.replace(/\s+/gu, " ").trim())
    .filter((text) => QUIP_PATTERNS.some((pattern) => pattern.test(text)));
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function isForkOwned(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  if (/\.test\.tsx?$/u.test(name)) return false;
  if (!/\.tsx?$/u.test(name)) return false;
  return (
    path.includes("/components/fork/") ||
    /\.fork\.tsx?$/u.test(name) ||
    /^Fork[A-Z].*\.tsx$/u.test(name) ||
    /^fork-.*\.tsx?$/u.test(name)
  );
}

function forkOwnedFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (isForkOwned(path)) found.push(path);
    }
  };
  walk(root);
  return found;
}

describe("findQuips", () => {
  it("flags copy that explains the concept instead of naming it", () => {
    expect(findQuips(`<p>Tabs here are shared by every thread.</p>`)).toEqual([
      "Tabs here are shared by every thread.",
    ]);
    expect(
      findQuips(`const detail = "Your notes lives in the vault";`),
    ).toEqual(["Your notes lives in the vault"]);
    expect(
      findQuips(`<Row detail="Pin it so you can find it later" />`),
    ).toEqual(["Pin it so you can find it later"]);
    expect(findQuips("title={`Read-only because it is mirrored`}")).toEqual([
      "Read-only because it is mirrored",
    ]);
    expect(findQuips(`<span>Don’t worry, nothing is lost.</span>`)).toEqual([
      "Don’t worry, nothing is lost.",
    ]);
    expect(
      findQuips(`"Pair it in the desktop app on the machine that runs bb."`),
    ).toHaveLength(1);
  });

  it("leaves names, counts, status, actions and errors alone", () => {
    expect(
      findQuips(`
        <Button>Pair this browser</Button>
        <p>Waiting for the bb desktop app.</p>
        const label = \`\${count} items\`;
        setFailed("Could not answer. Pair this browser again.");
        <span>Quiet check</span>
        const value = "so that";
      `),
    ).toEqual([]);
  });
});

describe("fork-owned UI copy", () => {
  it("names things and reports status without explaining the concept", () => {
    const quips = [
      join(repoRoot, "apps/app/src"),
      join(repoRoot, "apps/desktop/src"),
    ].flatMap((root) =>
      forkOwnedFiles(root).flatMap((path) =>
        findQuips(readFileSync(path, "utf8")).map(
          (text) => `${relative(repoRoot, path)}: ${text}`,
        ),
      ),
    );
    expect(quips).toEqual([]);
  });
});
