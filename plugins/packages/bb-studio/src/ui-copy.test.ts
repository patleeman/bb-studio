// The UI-text rule (AGENTS.md, "UI text"): no explanatory quips in Studio's UI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findQuips } from "./ui-copy-check";

describe("the quip matcher", () => {
  const quips = (source: string) => findQuips(source).map((quip) => quip.text);

  it("finds quips in JSX text, props, strings and templates", () => {
    expect(quips(`const a = <PageBar title="Memory" detail={\`\${name} · shared by every conversation\`} />;`)).toEqual(["${} · shared by every conversation"]);
    expect(quips(`const a = <><p>What the sidebar leaves out: old ones.</p><p>Search finds them too.</p></>;`)).toHaveLength(2);
    expect(quips(`toast("Record archived. The Bot won't find it.");`)).toEqual(["Record archived. The Bot won't find it."]);
    expect(quips(`const a = <p>Nothing on it is changed, moved or deleted.</p>;`)).toHaveLength(1);
    expect(quips(`const a = "Its files live in the Library, so you can find them";`)).toHaveLength(1);
    expect(quips(`const a = "Core profile · read at the start of every conversation";`)).toHaveLength(1);
  });

  it("leaves names, counts, status, dates, actions and errors alone", () => {
    for (const source of [
      `const a = <PageBar title="Memory" detail={bot.name} />;`,
      `const a = "Read-only · running in bb";`,
      `const a = \`Core profile · edited \${date}\`;`,
      `const a = <p>No records</p>;`,
      `toast.error(\`Couldn't save the record: \${message}\`);`,
      `const a = "Deck · 3 directions";`,
      `const a = "Offline · audio saved on this device";`,
    ]) expect(quips(source)).toEqual([]);
  });

  it("skips comments, imports and lines marked ui-copy-ok", () => {
    expect(quips(`// shared by every conversation\nimport x from "./lives in";`)).toEqual([]);
    expect(quips(`const a = "shared by everyone"; // ui-copy-ok`)).toEqual([]);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "shelf" ? [] : sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

it("no Studio view has an explanatory quip", () => {
  const root = resolve(__dirname, "..");
  const files = [join(root, "app.tsx"), ...sources(join(root, "src"))];
  const found = files.flatMap((file) => findQuips(readFileSync(file, "utf8"), file).map((quip) => `${relative(root, file)}:${quip.line}: ${quip.text}`));
  expect(found).toEqual([]);
});

it("no Studio view says Loop to the user: the feature is called Todos", () => {
  const root = resolve(__dirname, "..");
  const files = [join(root, "app.tsx"), ...sources(join(root, "src"))];
  const text = /(>[^<>{}`"']*\b[Ll]oops?\b[^<>{}`"']*<)|((?:title|label|aria-label|placeholder|detail|tooltip)[=:]\s*["'`][^"'`]*\b[Ll]oops?\b)|(toast(?:\.\w+)?\(\s*["'`][^"'`]*\b[Ll]oops?\b)/;
  const found = files.flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) => (text.test(line) && !line.includes("ui-copy-ok") ? [`${relative(root, file)}:${index + 1}`] : [])));
  expect(found).toEqual([]);
});

it("no Studio view says mini app to the user: the Library calls them apps", () => {
  const root = resolve(__dirname, "..");
  const files = [join(root, "app.tsx"), ...sources(join(root, "src"))];
  const text = /(>[^<>{}`"']*\b[Mm]ini apps?\b)|(["'`][^"'`]*\b[Mm]ini apps?\b[^"'`]*["'`])/;
  const skip = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line) || /console\.\w+\(/.test(line) || line.includes("ui-copy-ok");
  const found = files.flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) => (text.test(line) && !skip(line) ? [`${relative(root, file)}:${index + 1}`] : [])));
  expect(found).toEqual([]);
});
