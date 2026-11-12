// The UI-text rule (AGENTS.md, "UI text"): UI text names things and states
// facts. This finds the common quips in a .tsx file's user-visible text: its
// string literals, template text and JSX text. A line that must keep a match
// carries `// ui-copy-ok`. Used by src/ui-copy.test.ts only.
import ts from "typescript";

export const QUIP_PATTERNS: readonly RegExp[] = [
  /\bshared by\b/i,
  /\blives? in\b/i,
  /\bso (?:you|that) can\b/i,
  /\bthe Bot (?:sees|knows|reads|adds|finds|won't find)\b/i,
  /\bread-only because\b/i,
  /\bmade by the Bot and its workers\b/i,
  /\bnothing (?:on it )?is (?:changed|lost|moved|deleted)\b/i,
  /\bleft (?:as it was|untouched)\b/i,
  /\bdon't worry\b/i,
  /\bjust\b.*\bfor you\b/i,
  /\bwhat the sidebar leaves out\b/i,
  /\bfinds them too\b/i,
  /\byou can (?:also|always)\b/i,
  // A sentence after "·" in a header: "Chief of Staff · what the sidebar leaves out".
  /·\s+(?:what|where|how|why|which|who|read|shared|made|used|kept|the|it|its|for|so|this|these|everything|anything)\b(?:\s+[a-z'][a-z']*){2,}/,
];

export interface Quip {
  line: number;
  text: string;
  pattern: RegExp;
}

/** The quips in one source file's user-visible text. */
export function findQuips(source: string, fileName = "file.tsx"): Quip[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = source.split("\n");
  const found: Quip[] = [];
  const check = (node: ts.Node, text: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
    if (lines[line]?.includes("ui-copy-ok")) return;
    const flat = text.replace(/\s+/g, " ");
    const pattern = QUIP_PATTERNS.find((each) => each.test(flat));
    if (pattern) found.push({ line: line + 1, text: flat.trim(), pattern });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) check(node, node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      check(node, [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("${}"));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
