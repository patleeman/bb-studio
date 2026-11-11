// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ExperimentalSourceSkill } from "@get-bb/plugin-sdk";
import type { SkillSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { SkillsOverview } from "./SkillsCollection";
import { matchingSourceSkills } from "./ForkSkillSources";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

const USER_SKILL: SkillSummary = {
  id: `skill_${"a".repeat(64)}`,
  name: "code-review",
  description: "Review the current diff.",
  provider: null,
  scope: "bb-user",
  pluginId: null,
  filePath: "/home/u/.bb/skills/code-review/SKILL.md",
  manageable: true,
  registrySkillId: null,
};

const OFFICIAL_SKILL: SkillSummary = {
  ...USER_SKILL,
  id: `skill_${"b".repeat(64)}`,
  name: "official-skill",
  description: "Shipped with bb.",
  scope: "bb-builtin",
  manageable: false,
};

function registerSources(
  sources: Record<string, readonly ExperimentalSourceSkill[] | (() => never)>,
) {
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      skillSources: Object.entries(sources).map(([label, skills]) => ({
        id: label.toLowerCase().replaceAll(" ", "-"),
        label,
        useSkills: typeof skills === "function" ? skills : () => skills,
      })),
    }),
  );
}

function renderSkills(skills: readonly SkillSummary[] = [USER_SKILL]) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  render(
    <Wrapper>
      <SkillsOverview
        skills={skills}
        providerRoster={new Map()}
        isLoading={false}
        hasError={false}
        onCreateSkill={() => {}}
        onSelectSkill={() => {}}
      />
    </Wrapper>,
  );
}

function openFilters() {
  fireEvent.pointerDown(screen.getByRole("button", { name: /^Filters/ }));
}

function section(label: string): HTMLElement {
  return screen.getByRole("region", { name: label });
}

describe("plugin skill sources on the Skills page", () => {
  it("lists each source's skills under bb's own, under the source's label", () => {
    const onOpen = vi.fn();
    registerSources({
      "Chief of Staff": [
        {
          id: "triage",
          name: "Inbox triage",
          description: "Sort mail.",
          onOpen,
        },
        { id: "brief", name: "Morning brief" },
      ],
      Researcher: [{ id: "cite", name: "Cite sources" }],
    });
    renderSkills();
    const bbRow = screen.getByText("code-review");
    const chief = section("Chief of Staff");
    expect(
      bbRow.compareDocumentPosition(chief) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(chief).getByText("Sort mail.")).toBeTruthy();
    expect(
      within(chief)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining("Inbox triage"),
      expect.stringContaining("Morning brief"),
    ]);
    expect(
      within(section("Researcher")).getByText("Cite sources"),
    ).toBeTruthy();
    fireEvent.click(within(chief).getByText("Inbox triage"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("adds a Source filter with one option per source; choosing one lists only its skills", () => {
    registerSources({
      "Chief of Staff": [{ id: "triage", name: "Inbox triage" }],
      Researcher: [{ id: "cite", name: "Cite sources" }],
    });
    renderSkills();
    openFilters();
    expect(screen.getByText("Type")).toBeTruthy();
    expect(screen.getByText("Source")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Chief of Staff" }),
    );
    expect(screen.getByText("Inbox triage")).toBeTruthy();
    expect(screen.queryByText("Cite sources")).toBeNull();
    expect(screen.queryByText("code-review")).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Researcher" }),
    );
    expect(screen.getByText("Inbox triage")).toBeTruthy();
    expect(screen.getByText("Cite sources")).toBeTruthy();
    expect(screen.queryByText("code-review")).toBeNull();
  });

  it("joins a chosen source with bb's Type filter, and lists no source for bb's filters alone", () => {
    registerSources({
      "Chief of Staff": [{ id: "triage", name: "Inbox triage" }],
    });
    renderSkills([USER_SKILL, OFFICIAL_SKILL]);
    openFilters();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "User" }));
    expect(screen.getByText("code-review")).toBeTruthy();
    expect(screen.queryByText("official-skill")).toBeNull();
    expect(screen.queryByText("Inbox triage")).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Chief of Staff" }),
    );
    expect(screen.getByText("code-review")).toBeTruthy();
    expect(screen.getByText("Inbox triage")).toBeTruthy();
    expect(screen.queryByText("official-skill")).toBeNull();
  });

  it("shows an empty state when the chosen sources have no skills", () => {
    registerSources({ "Chief of Staff": [] });
    renderSkills();
    openFilters();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Chief of Staff" }),
    );
    expect(screen.queryByText("code-review")).toBeNull();
    expect(screen.getByText("No skills match these filters.")).toBeTruthy();
  });

  it("drops bb's no-match notice when a search matches only plugin skills", () => {
    registerSources({
      "Chief of Staff": [{ id: "triage", name: "Inbox triage" }],
    });
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    render(
      <Wrapper>
        <SkillsOverview
          skills={[USER_SKILL]}
          providerRoster={new Map()}
          isLoading={false}
          hasError={false}
          query="inbox"
          onCreateSkill={() => {}}
          onSelectSkill={() => {}}
        />
      </Wrapper>,
    );
    expect(screen.getByText("Inbox triage")).toBeTruthy();
    expect(screen.queryByText("code-review")).toBeNull();
    expect(screen.queryByText(/No skills match/u)).toBeNull();
  });

  it("hides a source whose hook throws and keeps the rest of the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerSources({
      Broken: () => {
        throw new Error("boom");
      },
      Researcher: [{ id: "cite", name: "Cite sources" }],
    });
    await act(async () => {
      renderSkills();
    });
    expect(screen.getByText("code-review")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Broken" })).toBeNull();
    expect(screen.getByText("Cite sources")).toBeTruthy();
  });

  it("adds nothing to the page when no plugin registers a source", () => {
    renderSkills();
    openFilters();
    expect(screen.queryByText("Source")).toBeNull();
    expect(screen.queryAllByRole("region")).toEqual([]);
  });
});

describe("matchingSourceSkills", () => {
  it("drops malformed rows, sorts by name and matches the query against name, description and label", () => {
    const skills = [
      { id: "b", name: "Beta", description: "second" },
      { id: "a", name: "Alpha" },
      { id: "x", name: "" },
      { name: "no id" },
      null,
    ];
    expect(
      matchingSourceSkills(skills, "Chief", "").map((skill) => skill.id),
    ).toEqual(["a", "b"]);
    expect(
      matchingSourceSkills(skills, "Chief", "second").map((skill) => skill.id),
    ).toEqual(["b"]);
    expect(
      matchingSourceSkills(skills, "Chief", "chief").map((skill) => skill.id),
    ).toEqual(["a", "b"]);
    expect(matchingSourceSkills("nope", "Chief", "")).toEqual([]);
  });
});
