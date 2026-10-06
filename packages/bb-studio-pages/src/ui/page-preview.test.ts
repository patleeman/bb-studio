import { expect, it } from "vitest";
import { chatMarkdown } from "./page-preview";

it("turns page mentions into links and other mentions into labels", () => {
  expect(chatMarkdown("See @[Plan](page:pg_abc), ask @[Ada](bot:bot_1) by @[2026-10-01](date:2026-10-01)."))
    .toBe("See [Plan](/plugins/pages/pages/pg_abc), ask @Ada by 2026-10-01.");
});

it("replaces JSON blocks with a line of text", () => {
  const markdown = [
    "Intro",
    "```chart",
    '{"type":"bar","title":"Revenue","data":[]}',
    "```",
    "```embed",
    '{"kind":"drawing","target":"dr_1","title":"Flow"}',
    "```",
    "```stats",
    '[{"label":"ARR","value":"$1.2M","delta":"+8%"},{"label":"Users","value":"40"}]',
    "```",
    "```chart",
    "not json",
    "```",
  ].join("\n");
  expect(chatMarkdown(markdown)).toBe([
    "Intro",
    "*Chart: Revenue*",
    "*Embedded drawing: Flow*",
    "- **ARR**: $1.2M (+8%)\n- **Users**: 40",
    "*Chart*",
  ].join("\n"));
});

it("leaves code untouched, mentions included", () => {
  const markdown = "````md\n```chart\n@[Plan](page:pg_abc)\n```\n````\nafter @[Plan](page:pg_abc)";
  expect(chatMarkdown(markdown)).toBe("````md\n```chart\n@[Plan](page:pg_abc)\n```\n````\nafter [Plan](/plugins/pages/pages/pg_abc)");
});

it("keeps an unclosed fence as code", () => {
  expect(chatMarkdown("```ts\nconst a = @[x](page:pg_a)")).toBe("```ts\nconst a = @[x](page:pg_a)");
});
