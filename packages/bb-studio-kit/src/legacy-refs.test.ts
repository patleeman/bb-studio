import { expect, it } from "vitest";
import { rewriteLegacyText, rewriteLegacyValue } from "./legacy-refs";

it("rewrites application links while preserving absolute module filesystem paths", () => {
  expect(rewriteLegacyText('[Bot](/plugins/bot-teams/bots/bot_1) https://bb.local/plugins/bot-teams/bots/bot_1')).toBe('[Bot](/plugins/studio/bots/bot_1) https://bb.local/plugins/studio/bots/bot_1');
  expect(rewriteLegacyText('/api/v1/plugins/bot-teams/http/file')).toBe('/api/v1/plugins/studio/http/file');
  expect(rewriteLegacyValue({ home: '/tmp/staged/data/plugins/bot-teams/homes/bot_1', href: '/plugins/bot-teams/bots/bot_1' })).toEqual({ home: '/tmp/staged/data/plugins/bot-teams/homes/bot_1', href: '/plugins/studio/bots/bot_1' });
});
