import { describe, expect, it } from "vitest";
import { addCheckinLine, bulletCount, CORE_TEMPLATE, lintAlwaysOn, sectionText, withSection } from "./core-skill";

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

  it("adds a check-in line once", () => {
    const once = addCheckinLine(CORE_TEMPLATE, "Weekday mornings: a brief.")!;
    expect(sectionText(once, "Check-in")).toMatch(/stuck\?\n- Weekday mornings: a brief\.$/);
    expect(addCheckinLine(once, "Weekday mornings: a brief.")).toBeNull();
    expect(addCheckinLine("## Preferences\n", "Inbox.")).toBe("## Preferences\n\n## Check-in\n\n- Inbox.\n");
  });

  it("lints the shared budget and the section caps, advisory only", () => {
    expect(lintAlwaysOn(CORE_TEMPLATE, CORE_TEMPLATE.length)).toEqual([]);
    expect(lintAlwaysOn(CORE_TEMPLATE, 3001)).toEqual([expect.stringContaining("over the 3,000 budget")]);
    const many = (n: number) => Array.from({ length: n }, (_, i) => `- Line ${i}`).join("\n");
    expect(lintAlwaysOn(`## Preferences\n\n${many(25)}\n\n## Right now\n\n${many(10)}`, 100)).toEqual([]);
    expect(lintAlwaysOn(`## Preferences\n\n${many(26)}\n\n## Right now\n\n${many(11)}`, 100)).toEqual([
      expect.stringContaining('"## Preferences" has 26 lines; its cap is 25'),
      expect.stringContaining('"## Right now" has 11 lines; its cap is 10'),
    ]);
  });
});
