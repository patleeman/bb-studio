import { expect, it } from "vitest";
import { parseCliArgs } from "./cli-args";

const list = { flags: ["--json", "--all"], options: ["--space", "--kind", "--tag", "--query"] };

it("parses valid arguments as before", () => {
  expect(parseCliArgs(["kind:page", "--json", "--space", "Garden", "-tag:draft", "pricing"], list)).toEqual({
    ok: true, flags: new Set(["--json"]), options: new Map([["--space", "Garden"]]), positional: ["kind:page", "-tag:draft", "pricing"],
  });
});

it("doesn't take another flag as an option's value", () => {
  expect(parseCliArgs(["--space", "--json"], list)).toEqual({ ok: false, error: "--space needs a value." });
});

it("rejects an option with no value", () => {
  expect(parseCliArgs(["pricing", "--kind"], list)).toEqual({ ok: false, error: "--kind needs a value." });
});

it("rejects unknown flags instead of treating them as query text or refs", () => {
  expect(parseCliArgs(["pricing", "--limit", "5"], list)).toEqual({ ok: false, error: "Unknown option --limit." });
  expect(parseCliArgs(["pg_1", "--dry-run", "--space", "Garden"], { options: ["--space", "--project"] })).toEqual({ ok: false, error: "Unknown option --dry-run." });
});

it("rejects an option given twice", () => {
  expect(parseCliArgs(["--space", "A", "--space", "B"], list)).toEqual({ ok: false, error: "--space was given twice." });
});

it("lists every `bb studio` command in the usage line for an unknown one", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const names = [...source.matchAll(/\{ name: "(\w+)", summary: .*?usage: "bb studio /g)].map((match) => match[1]!);
  const line = /usage\("bb studio <([a-z|]+)> …"\)/.exec(source)?.[1]?.split("|");
  expect(names.length).toBeGreaterThan(8);
  expect(line?.slice().sort()).toEqual(names.slice().sort());
});
