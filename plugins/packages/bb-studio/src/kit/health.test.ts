import { expect, it } from "vitest";
import { z } from "zod";
import { healthSchemas } from "./health";

it("accepts only in-app fix paths", () => {
  const { check } = healthSchemas(z);
  const parse = (path: string) => check.safeParse({ id: "x", status: "ok", title: "t", fix: { label: "Fix", path } }).success;
  expect(parse("/settings/plugins/pages")).toBe(true);
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "/a\\b", "javascript:alert(1)"]) expect(parse(bad)).toBe(false);
});
