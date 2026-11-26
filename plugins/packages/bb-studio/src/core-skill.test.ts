import { describe, expect, it } from "vitest";
import { addCheckinLine, bulletCount, canonicalSection, CORE_TEMPLATE, lintAlwaysOn, sectionCap, sectionText, withSection } from "./core-skill";

describe("always-on core skill text", () => {
  it("reads a section under its heading, whatever its spelling", () => {
    const body = "## Preferences\n\n- Short answers.\n- One recommendation.\n\n## Check-ins\n\n- Inbox.\n";
    expect(sectionText(body, "Preferences")).toBe("- Short answers.\n- One recommendation.");
    expect(sectionText(body, "Check-in")).toBe("- Inbox.");
    expect(sectionText(body, "Right now")).toBeNull();
    expect(bulletCount(sectionText(body, "Preferences"))).toBe(2);
  });

  it("replaces one section and adds a missing one at the end", () => {
    expect(withSection(CORE_TEMPLATE, "Right now", "- Travelling this week.")).toContain("## Right now\n\n- Travelling this week.\n\n## Check-in");
    expect(withSection("## Preferences\n\n- A.\n", "Check-in", "- B.")).toBe("## Preferences\n\n- A.\n\n## Check-in\n\n- B.\n");
  });

  it("ends a section only at the next ## heading: a # title or ### subheading inside it is its text", () => {
    const body = "# Dot's profile\n\n## Preferences\n\n- A.\n\n### Writing\n\n- B.\n\n# Notes\n\n- C.\n\n## Check-in\n\n- D.\n";
    expect(sectionText(body, "Preferences")).toBe("- A.\n\n### Writing\n\n- B.\n\n# Notes\n\n- C.");
    expect(bulletCount(sectionText(body, "Preferences"))).toBe(3);
    const next = withSection(body, "Preferences", "- Z.");
    expect(next).toBe("# Dot's profile\n\n## Preferences\n\n- Z.\n\n## Check-in\n\n- D.\n");
    expect(sectionCap("preferences")).toBe(25);
    expect(sectionCap("Right Now")).toBe(10);
    expect(sectionCap("Check-ins")).toBeNull();
    expect(canonicalSection("check-ins")).toBe("Check-in");
  });

  it("adds a check-in line once", () => {
    const once = addCheckinLine(CORE_TEMPLATE, "Weekday mornings: a brief.")!;
    expect(sectionText(once, "Check-in")).toMatch(/stuck\?\n- Weekday mornings: a brief\.$/);
    expect(addCheckinLine(once, "Weekday mornings: a brief.")).toBeNull();
    expect(addCheckinLine("## Preferences\n", "Inbox.")).toBe("## Preferences\n\n## Check-in\n\n- Inbox.\n");
  });

  it("lints the shared budget and the section caps, advisory only", () => {
    expect(lintAlwaysOn(CORE_TEMPLATE, CORE_TEMPLATE.length)).toEqual([]);
    expect(lintAlwaysOn(CORE_TEMPLATE, 2001)).toEqual([expect.stringContaining("over the 2,000 budget")]);
    const many = (n: number) => Array.from({ length: n }, (_, i) => `- Line ${i}`).join("\n");
    expect(lintAlwaysOn(`## Preferences\n\n${many(25)}\n\n## Right now\n\n${many(10)}`, 100)).toEqual([]);
    expect(lintAlwaysOn(`## Preferences\n\n${many(26)}\n\n## Right now\n\n${many(11)}`, 100)).toEqual([
      expect.stringContaining('"## Preferences" has 26 lines; its cap is 25'),
      expect.stringContaining('"## Right now" has 11 lines; its cap is 10'),
    ]);
  });
});
