import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchFreshness, freshnessMessage } from "./SearchFreshness";
import type { SearchStatus } from "../contract";

const current: SearchStatus = { state: "current", pendingProviders: [], unavailableProviders: [], discoveryIncomplete: false, revision: 1 };
describe("search freshness feedback", () => {
  it("keeps current search quiet and distinguishes availability from incomplete content", () => {
    expect(freshnessMessage(current)).toBeNull();
    expect(freshnessMessage({ ...current, state: "stale", pendingProviders: ["pages"] })).toContain("recent content may be missing");
    expect(freshnessMessage({ ...current, state: "stale", unavailableProviders: ["pages"] })).toContain("add-ons are unavailable");
    expect(freshnessMessage({ ...current, state: "stale", discoveryIncomplete: true })).toContain("could not be checked");
    expect(freshnessMessage({ ...current, state: "recovering" })).toContain("Updating Studio search");
  });
  it("never claims current results when status cannot be read", () => {
    expect(freshnessMessage(current, true)).toBe("Search freshness could not be checked.");
  });
});

it("announces stale results politely with a keyboard-accessible retry button", () => {
  const markup = renderToStaticMarkup(createElement(SearchFreshness, {
    status: { ...current, state: "stale", pendingProviders: ["pages"] },
    error: false, retrying: false, retry: async () => {},
  }));
  expect(markup).toContain('role="status"');
  expect(markup).toContain('aria-live="polite"');
  expect(markup).toContain('<button type="button"');
  expect(markup).toContain('>Retry</button>');
});
