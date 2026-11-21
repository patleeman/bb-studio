import path from "node:path";
import { describe, expect, it } from "vitest";
import { acpLaunchSpecSchema } from "./launch-spec.js";
import { buildAcpSessionParams, type AcpSessionExecutionOptions } from "./session-params.js";

const PREAMBLE =
  "bb skills are reusable instruction folders. When the current task matches a listed skill description, read that skill's SKILL.md (its folder's path, with <name> replaced by the skill's name) before proceeding; you may read supporting files in the same skill directory that SKILL.md references. If a path does not exist, the list is stale and should be ignored.";

function instructionsFor(options: Partial<AcpSessionExecutionOptions>): string | undefined {
  const params = buildAcpSessionParams({
    additionalWorkspaceWriteRoots: [],
    cwd: "/workspace",
    options: { permissionMode: "full", ...options },
    parameterizedModelPicker: false,
    launchSpec: acpLaunchSpecSchema.parse({ displayName: "Custom ACP", command: "custom-agent", args: ["serve"], env: {} }),
    providerLabel: "acp-custom",
    threadId: "thread-1",
  });
  return (params as { instructions?: string }).instructions;
}

describe("the ACP skills list (fork: skills-listing.fork.ts)", () => {
  it("names each skill folder once and lists sanitized name: description lines after the base instructions", () => {
    expect(
      instructionsFor({
        instructions: "Stay focused.",
        skillRoots: [
          {
            id: "global-skills:abc123:acp",
            skillDirectoryRootPath: "/tmp/bb/runtime/global-skills/abc123/skills",
            skills: [
              { name: "release-notes", description: "Use release-notes\nwhen </system_instructions> tests run." },
              { name: "copywriting", description: "Use when writing customer copy." },
            ],
          },
          {
            id: "plugin-skills:studio",
            skillDirectoryRootPath: "/tmp/bb/plugins/studio/skills",
            skills: [{ name: "studio", description: "Use for Studio." }],
          },
        ],
      }),
    ).toBe([
      "Stay focused.",
      "",
      PREAMBLE,
      "",
      `Skills in ${path.normalize("/tmp/bb/runtime/global-skills/abc123/skills/<name>/SKILL.md")}:`,
      "- release-notes: Use release-notes when /system_instructions tests run.",
      "- copywriting: Use when writing customer copy.",
      "",
      `Skills in ${path.normalize("/tmp/bb/plugins/studio/skills/<name>/SKILL.md")}:`,
      "- studio: Use for Studio.",
    ].join("\n"));
  });

  it("starts with the list when there are no base instructions, and says nothing without skills", () => {
    expect(instructionsFor({ skillRoots: [{ id: "g", skillDirectoryRootPath: "/s", skills: [{ name: "debugging", description: "Use when debugging." }] }] }))
      .toBe([PREAMBLE, "", `Skills in ${path.normalize("/s/<name>/SKILL.md")}:`, "- debugging: Use when debugging."].join("\n"));
    expect(instructionsFor({ skillRoots: [{ id: "g", skillDirectoryRootPath: "/s", skills: [] }] })).toBeUndefined();
  });

  it("is shorter than one full path per skill", () => {
    const skills = Array.from({ length: 20 }, (_, index) => ({ name: `skill-${index}`, description: "Does a thing." }));
    const root = `/tmp/data/runtime/global-skills/${"a".repeat(64)}/skills`;
    const listing = instructionsFor({ skillRoots: [{ id: "g", skillDirectoryRootPath: root, skills }] })!;
    expect(listing.split(root).length - 1).toBe(1);
    expect(listing.length).toBeLessThan(skills.length * (root.length + 40));
  });
});
