// BB refuses a plugin whose setting keys aren't letters, digits, "-" and "_":
// Studio then fails to load ("reload failed: invalid setting key"). Every
// `settings.define({...})` in Studio's source keeps to that.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { STUDIO_KEY_SETTINGS } from "./settings/keys";
import { LEGACY_SETTINGS } from "./settings/migrate";
import { STUDIO_SETTINGS } from "./settings/schema";

const root = join(__dirname, "..");
const VALID = /^[A-Za-z0-9_-]+$/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "dist") return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function definedKeys(path: string): string[] {
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const keys: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "define" && /settings$/.test(node.expression.expression.getText(file))) {
      const [arg] = node.arguments;
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) keys.push(prop.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return keys;
}

describe("plugin setting keys", () => {
  it("use only letters, digits, - and _", () => {
    const files = [...sources(join(root, "src")), join(root, "server.ts")];
    const keys = files.flatMap((path) => definedKeys(path).map((key) => ({ path: path.slice(root.length + 1), key })));
    expect(keys.filter(({ key }) => !VALID.test(key))).toEqual([]);
    // Studio declares the old fields on the migrating load; its API keys and
    // its own settings keep the same names.
    const declared = [...Object.keys(STUDIO_KEY_SETTINGS), ...Object.keys(LEGACY_SETTINGS), ...Object.keys(STUDIO_SETTINGS)];
    expect(declared).toContain("loopsEnabled");
    expect(declared.filter((key) => !VALID.test(key))).toEqual([]);
  });
});
