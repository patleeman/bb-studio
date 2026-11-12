// Code blocks: the languages the picker offers and the Shiki highlighter.
// Grammars are bundled one by one, so only these languages add weight. C++
// (half a megabyte) and Ruby and PHP (a dozen embedded grammars each) are
// left out; their code shows as plain text.
import { createCodeBlockSpec } from "@blocknote/core";
import { createHighlighterCore, type HighlighterGeneric } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: "Plain text", aliases: ["txt", "plaintext", "none"] },
  typescript: { name: "TypeScript", aliases: ["ts", "mts", "cts"] },
  tsx: { name: "TSX" },
  javascript: { name: "JavaScript", aliases: ["js", "mjs", "cjs"] },
  jsx: { name: "JSX" },
  json: { name: "JSON", aliases: ["jsonc", "json5"] },
  python: { name: "Python", aliases: ["py"] },
  shellscript: { name: "Shell", aliases: ["bash", "sh", "shell", "zsh", "console"] },
  go: { name: "Go", aliases: ["golang"] },
  rust: { name: "Rust", aliases: ["rs"] },
  sql: { name: "SQL" },
  html: { name: "HTML" },
  css: { name: "CSS" },
  yaml: { name: "YAML", aliases: ["yml"] },
  markdown: { name: "Markdown", aliases: ["md"] },
  diff: { name: "Diff", aliases: ["patch"] },
  java: { name: "Java" },
  kotlin: { name: "Kotlin", aliases: ["kt"] },
  swift: { name: "Swift" },
  c: { name: "C", aliases: ["h"] },
  csharp: { name: "C#", aliases: ["cs", "c#"] },
  toml: { name: "TOML" },
  dockerfile: { name: "Dockerfile", aliases: ["docker"] },
  graphql: { name: "GraphQL", aliases: ["gql"] },
  xml: { name: "XML", aliases: ["svg"] },
};

/** The picker id for a fence language: "ts" is "typescript"; unknown is "text". */
export function codeLanguageId(language: string): string {
  const lower = language.trim().toLowerCase();
  if (lower in CODE_LANGUAGES) return lower;
  for (const [id, { aliases }] of Object.entries(CODE_LANGUAGES)) if (aliases?.includes(lower)) return id;
  return "text";
}

/** Typed for `SyntaxHighlightingExtension`, which takes a highlighter of any languages. */
export function createHighlighter(): Promise<HighlighterGeneric<any, any>> {
  return createHighlighterCore({
    // A light and a dark theme, so BlockNote colours tokens for either.
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/tsx.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/jsx.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/python.mjs"),
      import("shiki/langs/shellscript.mjs"),
      import("shiki/langs/go.mjs"),
      import("shiki/langs/rust.mjs"),
      import("shiki/langs/sql.mjs"),
      import("shiki/langs/html.mjs"),
      import("shiki/langs/css.mjs"),
      import("shiki/langs/yaml.mjs"),
      import("shiki/langs/markdown.mjs"),
      import("shiki/langs/diff.mjs"),
      import("shiki/langs/java.mjs"),
      import("shiki/langs/kotlin.mjs"),
      import("shiki/langs/swift.mjs"),
      import("shiki/langs/c.mjs"),
      import("shiki/langs/csharp.mjs"),
      import("shiki/langs/toml.mjs"),
      import("shiki/langs/docker.mjs"),
      import("shiki/langs/graphql.mjs"),
      import("shiki/langs/xml.mjs"),
    ],
    engine: createJavaScriptRegexEngine(),
  }) as Promise<HighlighterGeneric<any, any>>;
}

const base = createCodeBlockSpec({ supportedLanguages: CODE_LANGUAGES });

/**
 * BlockNote's code block throws when a block's language isn't in the picker.
 * Agents and pasted markdown write any fence language, so the picker shows
 * the language's id, or Plain text, while the block keeps what was written.
 */
export const codeBlockSpec: typeof base = {
  ...base,
  implementation: {
    ...base.implementation,
    render(block, editor) {
      const language = codeLanguageId(block.props.language);
      const shown = language === block.props.language ? block : { ...block, props: { ...block.props, language } };
      return base.implementation.render.call(this, shown, editor);
    },
  },
};
