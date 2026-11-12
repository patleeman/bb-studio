import { expect, it } from "vitest";
import { catchAll, dateIn, EMPTY_PROFILE, planSplit, PROFILE_HEADING, recordItems, sections } from "./split";
import { PROFILE_CAP_CHARS } from "./shared";
import { MEMORY_PAGE } from "./test-fixture";

const page = { id: "pg_old", title: "Chief of Staff's Memory", updatedAt: new Date(2026, 10, 9, 18).getTime() };
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

it("keeps the check-in list and how the user works in the profile, and makes everything else records", () => {
  const plan = planSplit({ markdown: MEMORY_PAGE, page, botName: "Chief of Staff" });
  expect(plan.sections.map((section) => [section.heading, section.target])).toEqual([
    ["Check-in", "profile"], ["Who he is", "records"], ["How he works", "profile"], ["Hard rules", "records"],
    ["Systems", "records"], ["Facts and decisions", "records"], ["Launch", "records"], ["Preferences", "records"], ["People and places", "records"],
  ]);
  expect(plan.sections.some((section) => section.overCap)).toBe(false);
  expect(plan.profile.title).toBe("Chief of Staff's core profile");
  // Verbatim, in page order, without the page's own H1 title.
  expect(plan.profile.markdown).toBe(`## Check-in

- Anything waiting on Sam, or threads I started that finished, failed or stalled?
- Garage door sensor battery: remind on the 1st of the month.

## How he works

- Wants one recommendation, not a survey of options.
- Short reports in simple English; say what failed.
- Works on \`main\` with small commits.
`);
  expect(plan.profile.chars).toBe(plan.profile.markdown.trim().length);
  expect(plan.records.map((record) => [record.topic, record.text, record.section])).toEqual([
    // The text above the first heading is records too.
    ["Notes", "Notes the Bot keeps about Sam and the work. Edited by both.", null],
    ["Who he is", "Sam is a staff engineer in Portland, preparing for system design interviews.", "Who he is"],
    ["Hard rules", "Never send email on his behalf without asking.", "Hard rules"],
    ["Hard rules", "Read-only on the home server unless he approves a command.", "Hard rules"],
    ["nas1", "**nas1:** Synology DS920+, reached over Tailscale at nas1.tail.", "Systems"],
    ["Systems", "Backups run Saturday 03:00–05:00; refused ports then are expected.", "Systems"],
    ["Systems", "Home Assistant lives on the Pi 4 in the hall closet.\n- Zigbee stick: SONOFF, on USB 2.", "Systems"],
    ["Facts and decisions", "2026-10-28: picked Hetzner over Fly for the side project (cost).", "Facts and decisions"],
    ["Facts and decisions", "Nov 6: launch outline gives high-level design 20 minutes.", "Facts and decisions"],
    ["Facts and decisions", "Decided on Oct 3 to drop the Notion export; Pages is the source.", "Facts and decisions"],
    ["Facts and decisions", "The dentist moved to Thursdays.", "Facts and decisions"],
    // "Facts and decisions" is a catch-all parent, so its subsection is just "Launch".
    ["Launch", "One 45-minute mock a day, top of the library first.", "Launch"],
    ["Launch", "Item: Passport renewal; Due: 2026-12-01", "Launch"],
    ["Launch", "Item: Car registration; Due: 2027-01-15", "Launch"],
    ["Preferences", "Coffee: oat flat white.", "Preferences"],
    ["Preferences", "Prefers dark mode everywhere.\n```\nalias gs=\"git status -sb\"\n```", "Preferences"],
    ["People and places", "Alex (partner), Jo (sister, Seattle).", "People and places"],
    ["People and places", "Home: 12 Alder Lane.", "People and places"],
  ]);
  // Dates from the text, else the page's last edit.
  const at = (text: string) => plan.records.find((record) => record.text.startsWith(text))!;
  expect(at("2026-10-28")).toMatchObject({ createdAt: day(2026, 10, 28), dated: true });
  expect(at("Nov 6")).toMatchObject({ createdAt: day(2026, 11, 6), dated: true });
  expect(at("Decided on Oct 3")).toMatchObject({ createdAt: day(2026, 10, 3), dated: true });
  expect(at("The dentist")).toMatchObject({ createdAt: page.updatedAt, dated: false });
  // A date after the page's last edit is a due date, not when it was noted.
  expect(at("Item: Passport renewal")).toMatchObject({ createdAt: page.updatedAt, dated: false });
});

it("reads the profile headings in any case and for any name", () => {
  expect(["Check-in", "CHECK-IN", "check in", "Checkins", "Weekly check-ins", "How Patrick works", "how PATRICK Works", "How he works", "How I work", "How Zoë works"].filter((heading) => PROFILE_HEADING.test(heading))).toHaveLength(10);
  expect(["Who he is", "Hard rules", "Preferences", "People", "How it works", "How the backup works", "Checking out"].some((heading) => PROFILE_HEADING.test(heading))).toBe(false);
});

/** A check-in list and a how-he-works section that together are over the 2,500-character cap. */
const OVER_CAP_PAGE = `## Check-in

${Array.from({ length: 12 }, (_, index) => `- Check ${index + 1}: anything waiting on Patrick from the morning sweep?`).join("\n")}

## How Patrick works

${Array.from({ length: 30 }, (_, index) => `- Habit ${index + 1}: one recommendation, short reports in simple English.`).join("\n")}

## Systems

- homelab backs up on Saturday.
`;

it("moves the longest profile section to records when the profile is over the cap, until it fits", () => {
  const checkIn = OVER_CAP_PAGE.slice(0, OVER_CAP_PAGE.indexOf("\n\n## How")).length;
  const how = OVER_CAP_PAGE.slice(OVER_CAP_PAGE.indexOf("## How"), OVER_CAP_PAGE.indexOf("\n\n## Systems")).length;
  expect(checkIn + how).toBeGreaterThan(PROFILE_CAP_CHARS);
  expect(how).toBeGreaterThan(checkIn);
  const plan = planSplit({ markdown: OVER_CAP_PAGE, page, botName: "Dot" });
  expect(plan.sections.map((section) => [section.heading, section.target, section.overCap])).toEqual([
    ["Check-in", "profile", false], ["How Patrick works", "records", true], ["Systems", "records", false],
  ]);
  expect(plan.profile.chars).toBeLessThanOrEqual(PROFILE_CAP_CHARS);
  expect(plan.profile.markdown).toMatch(/^## Check-in\n\n- Check 1:/);
  expect(plan.profile.markdown).not.toContain("Habit");
  expect(plan.records.filter((record) => record.section === "How Patrick works")).toHaveLength(30);
  expect(plan.records.at(-1)).toMatchObject({ topic: "Systems", text: "homelab backs up on Saturday." });
  // A smaller cap moves the next longest too; an empty profile gets the two headings.
  const tight = planSplit({ markdown: OVER_CAP_PAGE, page, botName: "Dot", cap: 100 });
  expect(tight.sections.filter((section) => section.overCap).map((section) => section.heading)).toEqual(["Check-in", "How Patrick works"]);
  expect(tight.profile.markdown).toBe(EMPTY_PROFILE);
});

it("reads dates without a year as the latest one on or before the page's edit", () => {
  expect(dateIn("met Dec 20", page.updatedAt)).toBe(day(2025, 12, 20));
  expect(dateIn("on 7 November", page.updatedAt)).toBe(day(2026, 11, 7));
  expect(dateIn("due 11/30/2026", page.updatedAt)).toBe(day(2026, 11, 30));
  expect(dateIn("ISO 2026-02-30 is no date", page.updatedAt)).toBeNull();
  expect(dateIn("no dates here, may be later", page.updatedAt)).toBeNull();
  // The first date written wins.
  expect(dateIn("Nov 2, moved from 2026-10-01", page.updatedAt)).toBe(day(2026, 11, 2));
});

it("handles a page with no headings, duplicate headings, and headings inside code", () => {
  expect(planSplit({ markdown: "Just a note.\n\nAnother.", page, botName: "Dot" })).toMatchObject({ sections: [], records: [{ topic: "Notes", text: "Just a note.", section: null }, { topic: "Notes", text: "Another.", section: null }], profile: { markdown: EMPTY_PROFILE } });
  const parsed = sections("## Notes\n- a\n## Notes\n- b\n```\n## not a heading\n```\n");
  expect(parsed.sections.map((section) => section.key)).toEqual(["notes", "notes-2"]);
  expect(recordItems(parsed.sections[1]!.lines, "Notes")).toEqual([{ topic: "Notes", text: "b\n```\n## not a heading\n```" }]);
  // A page with neither profile section gets the two empty headings.
  expect(planSplit({ markdown: "## Systems\n- x", page, botName: "Dot" }).profile.markdown).toBe(EMPTY_PROFILE);
});

/** Shaped like a real Memory page: a check-in list, then everything else as subsections of one "Memory" section. */
const NESTED_PAGE = `# Chief of Staff's Memory

## Check-in

- Anything waiting on Patrick?
- Threads I started that finished, failed or stalled.
- Garage sensor battery: the 1st of the month.

## Memory

Long-lived notes; the newest at the bottom of each part.

### How Patrick works

- One recommendation, not a survey of options.
- Short reports in simple English.

### Standing rules

- Never push the fork.

### People

- Alex (partner).

### Family

- Jo (sister, Seattle).

### Places

- Home: 12 Alder Lane.

### Contacts

- Dentist: 555-0100.

### Values

- Fewer, better things.

### Preferences

- Oat flat white.

### Fork

- 2026-11-02: the sync agent runs daily.
- The ledger budget is per file.

### Launch

- One mock a day.

#### System design

- High-level design gets 20 minutes.

### homelab

- **nas:** Unraid, backups Saturday 03:00.

## Projects

---

### Larkspur

- Phase 2 starts after the survey.
`;

it("splits every heading level: each subsection is a unit, kept in the profile only by its own heading or one above it", () => {
  const plan = planSplit({ markdown: NESTED_PAGE, page, botName: "Chief of Staff" });
  expect(plan.sections.map((section) => [section.key, section.heading, section.target])).toEqual([
    ["check-in", "Check-in", "profile"],
    // The parent's own text, before its first subsection.
    ["memory", "Memory", "records"],
    ["how-patrick-works", "How Patrick works", "profile"],
    ["standing-rules", "Standing rules", "records"],
    ["people", "People", "records"],
    ["family", "Family", "records"],
    ["places", "Places", "records"],
    ["contacts", "Contacts", "records"],
    ["values", "Values", "records"],
    ["preferences", "Preferences", "records"],
    ["fork", "Fork", "records"],
    ["launch", "Launch", "records"],
    // Under a parent that isn't a catch-all, the parent prefixes the label.
    ["launch-system-design", "Launch › System design", "records"],
    ["homelab", "homelab", "records"],
    // "Projects" has only a rule before its subsection, so it is no unit.
    ["projects-larkspur", "Projects › Larkspur", "records"],
  ]);
  expect(plan.profile.markdown).toBe(`## Check-in

- Anything waiting on Patrick?
- Threads I started that finished, failed or stalled.
- Garage sensor battery: the 1st of the month.

## How Patrick works

- One recommendation, not a survey of options.
- Short reports in simple English.
`);
  expect(plan.records.map((record) => [record.topic, record.text, record.section])).toEqual([
    ["Memory", "Long-lived notes; the newest at the bottom of each part.", "Memory"],
    ["Standing rules", "Never push the fork.", "Standing rules"],
    ["People", "Alex (partner).", "People"],
    ["Family", "Jo (sister, Seattle).", "Family"],
    ["Places", "Home: 12 Alder Lane.", "Places"],
    ["Contacts", "Dentist: 555-0100.", "Contacts"],
    ["Values", "Fewer, better things.", "Values"],
    ["Preferences", "Oat flat white.", "Preferences"],
    ["Fork", "2026-11-02: the sync agent runs daily.", "Fork"],
    ["Fork", "The ledger budget is per file.", "Fork"],
    ["Launch", "One mock a day.", "Launch"],
    ["Launch › System design", "High-level design gets 20 minutes.", "Launch › System design"],
    ["nas", "**nas:** Unraid, backups Saturday 03:00.", "homelab"],
    ["Projects › Larkspur", "Phase 2 starts after the survey.", "Projects › Larkspur"],
  ]);
  expect(plan.records.find((record) => record.topic === "Fork")).toMatchObject({ createdAt: day(2026, 11, 2), dated: true });
});

it("keeps a profile section's subsections with it, one level below, and labels records by a parent that isn't a catch-all", () => {
  const plan = planSplit({ markdown: "## How Sam works\n\nMornings only.\n\n### Communication\n\n- Short notes.\n\n## Notes\n\n### Garden\n\n- Tomatoes in May.\n\n## Projects\n\n### Larkspur\n\n- Phase 2.\n", page, botName: "Dot" });
  expect(plan.sections.map((section) => [section.key, section.heading, section.target])).toEqual([
    ["how-sam-works", "How Sam works", "profile"],
    ["how-sam-works-communication", "How Sam works › Communication", "profile"],
    ["garden", "Garden", "records"],
    ["projects-larkspur", "Projects › Larkspur", "records"],
  ]);
  expect(plan.profile.markdown).toBe("## How Sam works\n\nMornings only.\n\n### Communication\n\n- Short notes.\n");
  expect(plan.records.map((record) => record.topic)).toEqual(["Garden", "Projects › Larkspur"]);
  expect(["Memory", "Notes", "Misc", "Facts and decisions", "Sam's notes", "Long-term memory"].filter(catchAll)).toHaveLength(6);
  expect(["Projects", "Systems", "Launch", "Patrick's projects"].some(catchAll)).toBe(false);
});
