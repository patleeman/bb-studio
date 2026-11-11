import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Pseudo = "" | "::before" | "::after";

interface ForkCssRule {
  selector: string;
  pseudo: Pseudo;
  specificity: readonly [number, number, number];
  order: number;
  declarations: ReadonlyMap<string, string>;
}

const here = dirname(fileURLToPath(import.meta.url));

export const forkCss = readFileSync(join(here, "../fork.css"), "utf8");

function topLevelBlocks(css: string): { prelude: string; body: string }[] {
  const blocks: { prelude: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let bodyStart = 0;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") {
      if (depth === 0) bodyStart = index + 1;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        blocks.push({
          prelude: css.slice(start, bodyStart - 1).trim(),
          body: css.slice(bodyStart, index),
        });
        start = index + 1;
      }
    }
  }
  return blocks;
}

export function splitTopLevel(list: string, separator = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.replace(/\s+/gu, " ").trim());
}

function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of splitTopLevel(body, ";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    declarations.set(
      part.slice(0, colon).trim(),
      part
        .slice(colon + 1)
        .replace(/\s+/gu, " ")
        .trim(),
    );
  }
  return declarations;
}

function addSpecificity(
  total: [number, number, number],
  part: readonly [number, number, number],
) {
  total[0] += part[0];
  total[1] += part[1];
  total[2] += part[2];
}

function compareSpecificity(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function specificity(selector: string): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  let rest = selector;
  for (;;) {
    const match = /:(is|not|where|has)\(/u.exec(rest);
    if (match === null) break;
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < rest.length) {
      if (rest[end] === "(") depth += 1;
      if (rest[end] === ")") depth -= 1;
      end += 1;
    }
    const inner = rest.slice(match.index + match[0].length, end - 1);
    if (match[1] !== "where") {
      const arguments_ = splitTopLevel(inner).map(specificity);
      const max = arguments_.reduce<[number, number, number]>(
        (best, next) => (compareSpecificity(next, best) > 0 ? next : best),
        [0, 0, 0],
      );
      addSpecificity(total, max);
    }
    rest = `${rest.slice(0, match.index)} ${rest.slice(end)}`;
  }
  rest = rest.replace(/\[[^\]]*\]/gu, () => {
    total[1] += 1;
    return " ";
  });
  rest = rest.replace(/#[\w-]+/gu, () => {
    total[0] += 1;
    return " ";
  });
  rest = rest.replace(/::[\w-]+/gu, () => {
    total[2] += 1;
    return " ";
  });
  rest = rest.replace(/[.:][\w-]+/gu, () => {
    total[1] += 1;
    return " ";
  });
  total[2] += [...rest.matchAll(/(?:^|[\s>+~])[a-zA-Z][\w-]*/gu)].length;
  return total;
}

export function forkCssRules(): ForkCssRule[] {
  const rules: ForkCssRule[] = [];
  let order = 0;
  for (const { prelude, body } of topLevelBlocks(forkCss)) {
    if (prelude.startsWith("@")) continue;
    const declarations = parseDeclarations(body);
    for (const selector of splitTopLevel(prelude)) {
      const pseudo: Pseudo = selector.endsWith("::before")
        ? "::before"
        : selector.endsWith("::after")
          ? "::after"
          : "";
      rules.push({
        selector: selector.slice(0, selector.length - pseudo.length),
        pseudo,
        specificity: specificity(selector),
        order,
        declarations,
      });
      order += 1;
    }
  }
  return rules;
}

export function matchingForkRules(
  element: Element,
  pseudo: Pseudo = "",
): ForkCssRule[] {
  return forkCssRules().filter(
    (rule) => rule.pseudo === pseudo && element.matches(rule.selector),
  );
}

export function forkCascade(
  element: Element,
  property: string,
  pseudo: Pseudo = "",
): string | null {
  const winner = matchingForkRules(element, pseudo)
    .filter((rule) => rule.declarations.has(property))
    .sort(
      (a, b) =>
        compareSpecificity(a.specificity, b.specificity) || a.order - b.order,
    )
    .at(-1);
  return winner?.declarations.get(property) ?? null;
}
