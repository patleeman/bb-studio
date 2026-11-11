import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as app from "../app.js";

const forkSource = readFileSync(
  new URL("../app.fork.ts", import.meta.url),
  "utf8",
);
const forkExports = [...forkSource.matchAll(/^export const (\w+)/gm)].map(
  (match) => match[1],
);

describe("fork runtime exports", () => {
  it("finds the fork's runtime exports", () => {
    expect(forkExports.length).toBeGreaterThan(0);
  });

  it.each(forkExports)("re-exports %s from the app entry", (name) => {
    expect(Object.keys(app)).toContain(name);
  });
});
