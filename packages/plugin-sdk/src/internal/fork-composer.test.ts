import { describe, expect, it } from "vitest";
import { collectComposerCustomization } from "./composer-customization-validation.js";

function collect(registration: unknown) {
  const rejected: string[] = [];
  const parsed = collectComposerCustomization(
    registration,
    new Set(),
    (reason) => rejected.push(reason),
  );
  return { parsed, rejected };
}

describe("composer customization experimental_replace", () => {
  it("keeps a valid replacement beside the other regions", () => {
    const useActive = () => true;
    const component = () => null;
    const { parsed, rejected } = collect({
      id: "worker",
      scopes: ["thread"],
      experimental_replace: { useActive, component },
    });
    expect(rejected).toEqual([]);
    expect(parsed?.experimental_replace).toEqual({ useActive, component });
  });

  it("drops an invalid replacement, reports why, and keeps the customization", () => {
    const { parsed, rejected } = collect({
      id: "worker",
      experimental_replace: { useActive: true, component: () => null },
    });
    expect(parsed?.id).toBe("worker");
    expect(parsed?.experimental_replace).toBeUndefined();
    expect(rejected).toEqual([
      'composer.customize(worker).experimental_replace: "useActive" must be a function',
    ]);
    expect(
      collect({ id: "w", experimental_replace: { useActive: () => true } })
        .rejected,
    ).toEqual([
      'composer.customize(w).experimental_replace: "component" must be a React component function',
    ]);
    expect(collect({ id: "w", experimental_replace: 1 }).rejected).toEqual([
      "composer.customize(w).experimental_replace: must be an object when set",
    ]);
  });
});

describe("composer customization experimental_footer", () => {
  it("keeps valid footer items and drops invalid or repeated ones with a reason", () => {
    const component = () => null;
    const { parsed, rejected } = collect({
      id: "cache",
      scopes: ["thread"],
      experimental_footer: [
        { id: "chip", component },
        { id: "bad id", component },
        { id: "chip", component },
        { id: "other", component: "nope" },
      ],
    });
    expect(parsed?.experimental_footer).toEqual([{ id: "chip", component }]);
    expect(rejected).toHaveLength(3);
    expect(rejected[1]).toBe(
      'composer.customize(cache).experimental_footer[2]: duplicate id "chip"',
    );
    expect(collect({ id: "c", experimental_footer: {} }).rejected).toEqual([
      "composer.customize(c).experimental_footer: must be an array when set",
    ]);
    expect(collect({ id: "c" }).parsed).not.toHaveProperty(
      "experimental_footer",
    );
  });
});
