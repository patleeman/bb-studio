// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { defaultAppSettings } from "@bb/domain";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import type { UseThreadTimelineControllerResult } from "@/components/thread/timeline";
import { AppLayout } from "@/components/layout/AppLayout";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadScreen } from "@/views/thread-detail/ThreadScreen";
import { forkCascade, forkCssRules } from "@/test/fork-css-cascade";
import {
  backdropTokenRemaps,
  backgroundUtility,
  OPAQUE_ON_PURPOSE,
  translucentThemeTokens,
} from "@/test/fork-surface-audit";
import { PageShell } from "@/components/ui/page-shell";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { SkillDetailView } from "@/components/tools/SkillDetailView";
import { PluginPanelView } from "@/views/PluginPanelView";
import { RootComposeHome } from "@/views/RootComposeHome";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@bb/shared-ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import { Switch } from "@bb/shared-ui/switch";

const desktop = vi.hoisted(() => ({ framed: false }));

vi.mock("@/components/layout/AppLayoutSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    AppLayoutSidebar: () => (
      <Sidebar>
        <div data-sidebar="collapsible-body">
          <div data-sidebar="content" className="bg-sidebar">
            <section data-fork-card="sidebar" data-testid="plugin-nav" />
            <section data-fork-card="sidebar">
              <div data-testid="thread-list" />
            </section>
            <section data-fork-card="sidebar" data-testid="plugin-footer" />
          </div>
        </div>
      </Sidebar>
    ),
  };
});

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      experiments: {},
      generalSettings: defaultAppSettings,
      keybindings: [],
    },
  }),
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({ accessState: "unavailable" }),
}));

vi.mock("@/hooks/usePluginSafeModeCommands", () => ({
  usePluginSafeModeCommands: () => undefined,
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  ThreadActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/dialogs/ProjectPathDialog", () => ({
  ProjectPathDialog: () => null,
}));

vi.mock("@/lib/bb-desktop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bb-desktop")>();
  return {
    ...actual,
    getBbDesktopInfo: () => null,
    shouldReserveMacosTrafficLights: () => desktop.framed,
    shouldUseMacosDesktopChrome: () => desktop.framed,
  };
});

vi.mock("@/lib/favicon-color-preference", () => ({
  useFaviconBadge: vi.fn(),
}));

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    isCreating: false,
    platform: "darwin",
    projectPathDialog: { onOpenChange: vi.fn(), target: null },
    submitProjectPath: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      personalProject: {
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        sources: [],
        threads: [],
        defaultExecutionOptions: null,
        createdAt: 1,
        updatedAt: 1,
      },
      projects: [],
    },
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useArchivedThreads: () => ({ data: undefined }),
  useChildThreads: () => ({ data: [] }),
  didThreadDetailBootstrapRefreshAfterMount: () => true,
  useThread: () => ({ data: undefined }),
  useThreadDetailBootstrap: () => ({
    data: { projectId: "proj_screen" },
    isError: false,
    isSuccess: true,
  }),
  useThreadPendingInteractions: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/child-thread-pending-interactions", () => ({
  useChildThreadPendingAttention: () => [],
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => {
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return { useEditThreadMessage: mutation, useSendThreadMessage: mutation };
});

vi.mock("@/components/thread/timeline", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/thread/timeline")>();
  return {
    ...actual,
    ThreadTimelineSurface: () => <div data-testid="transcript" />,
  };
});

vi.mock("@/views/thread-detail/ThreadDetailPromptArea", () => ({
  ThreadDetailPromptArea: () => (
    <div data-app-composer="" data-promptbox-shell="" className="space-y-2">
      <div data-composer-box="" className="w-full">
        <form
          data-promptbox=""
          className="group/promptbox relative w-full rounded-xl border border-border bg-background shadow-lift"
        >
          <div data-testid="composer-input" />
        </form>
      </div>
    </div>
  ),
}));

const here = dirname(fileURLToPath(import.meta.url));
const forkCss = readFileSync(join(here, "../../fork.css"), "utf8");

interface BackdropRule {
  selector: string;
  pseudo: "" | "::before" | "::after";
  paints: boolean;
  clearsSidebarToken: boolean;
}

function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.replace(/\s+/gu, " ").trim());
}

function backdropRules(): BackdropRule[] {
  const rules: BackdropRule[] = [];
  for (const match of forkCss.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const body = match[2] ?? "";
    const paints = /(^|[;\s])background:/u.test(body);
    const clearsSidebarToken = /--sidebar:\s*transparent/u.test(body);
    for (const selector of splitSelectors(match[1] ?? "")) {
      if (!selector.startsWith("html[data-fork-backdrop]")) continue;
      const pseudo = selector.endsWith("::before")
        ? "::before"
        : selector.endsWith("::after")
          ? "::after"
          : "";
      rules.push({
        selector: selector.slice(0, selector.length - pseudo.length),
        pseudo,
        paints,
        clearsSidebarToken,
      });
    }
  }
  return rules;
}

const NON_PAINTING_BG =
  /^bg-(transparent|none|clip-.*|origin-.*|no-repeat|repeat.*|cover|contain|auto|center|top|bottom|left|right|fixed|local|scroll|blend-.*|size-.*|position-.*|\[length:.*|\[position:.*|\[size:.*)$/u;

interface Paint {
  element: Element;
  pseudo: "" | "::before" | "::after";
  utility: string;
}

function utilityOf(className: string): {
  variants: string[];
  utility: string;
} {
  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of className) {
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth -= 1;
    if (char === ":" && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  return { variants: segments, utility: current };
}

function paintsOf(element: Element): Paint[] {
  const paints: Paint[] = [];
  if (element === document.documentElement || element === document.body) {
    paints.push({ element, pseudo: "", utility: "base background" });
  }
  const className = element.getAttribute("class") ?? "";
  for (const name of className.split(/\s+/u).filter(Boolean)) {
    const { variants, utility } = utilityOf(name);
    const bare = utility.replace(/^!|!$/gu, "");
    if (!bare.startsWith("bg-") || NON_PAINTING_BG.test(bare)) continue;
    if (/^bg-border(-|\/|$)/u.test(bare)) continue;
    if (backgroundUtility(name)?.stateful === true) continue;
    if (variants.some((variant) => /^group-data-\[framed\]/u.test(variant))) {
      if (!element.closest("[data-framed]")) continue;
    }
    const pseudo = variants.includes("before")
      ? "::before"
      : variants.includes("after")
        ? "::after"
        : "";
    paints.push({ element, pseudo, utility: name });
  }
  if (element instanceof HTMLElement) {
    const inline = element.style;
    if (
      [inline.background, inline.backgroundColor, inline.backgroundImage].some(
        (value) => value !== "" && value !== "transparent" && value !== "none",
      )
    ) {
      paints.push({ element, pseudo: "", utility: "inline style" });
    }
  }
  return paints;
}

function covered(paint: Paint, rules: readonly BackdropRule[]): boolean {
  if (/!/u.test(paint.utility)) return false;
  const direct = rules.some(
    (rule) =>
      rule.paints &&
      rule.pseudo === paint.pseudo &&
      paint.element.matches(rule.selector),
  );
  if (direct) return true;
  const utility = backgroundUtility(paint.utility);
  if (utility === null || paint.pseudo !== "") return false;
  if (translucentThemeTokens().has(utility.name)) return true;
  return backdropTokenRemaps().some(
    (remap) =>
      remap.token === utility.name &&
      paint.element.closest(remap.scope) !== null,
  );
}

function describePaint(paint: Paint): string {
  const element = paint.element;
  const marks = [...element.attributes]
    .filter((attribute) => attribute.name.startsWith("data-"))
    .map((attribute) => `[${attribute.name}]`)
    .join("");
  return `<${element.tagName.toLowerCase()}${marks}>${paint.pseudo} ${paint.utility}`;
}

function isOpaqueOnPurpose(paint: Paint): boolean {
  const utility = backgroundUtility(paint.utility);
  return utility !== null && utility.name in OPAQUE_ON_PURPOSE;
}

function layersIn(root: Element): { opaque: string[]; dense: string[] } {
  const rules = backdropRules();
  const opaque: string[] = [];
  const dense: string[] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const paint of paintsOf(element)) {
      if (covered(paint, rules)) continue;
      (isOpaqueOnPurpose(paint) ? dense : opaque).push(describePaint(paint));
    }
  }
  return { opaque, dense };
}

function opaqueLayersAbove(start: Element): string[] {
  const rules = backdropRules();
  const opaque: string[] = [];
  for (
    let element: Element | null = start;
    element !== null;
    element = element.parentElement
  ) {
    for (const paint of paintsOf(element)) {
      if (!covered(paint, rules)) opaque.push(describePaint(paint));
    }
  }
  return opaque;
}

const THREAD = makeThreadResponse({
  id: "thr_screen",
  projectId: "proj_screen",
  status: "active",
  runtime: { displayStatus: "active" },
});

const TIMELINE = {
  activeBackgroundCommands: [],
  activePromptMode: null,
  activeThinking: null,
  activeWorkflows: [],
  contextBoundarySeq: null,
  contextWindowUsage: null,
  hasOlderTimelineRows: false,
  isCatchingUpTimeline: false,
  isLoadingOlderTimelineRows: false,
  loadOlderTimelineRows: async () => {},
  modelFallback: null,
  pendingTodos: null,
  providerCommands: null,
  sessionOptions: null,
  timelineError: null,
  timelineLoading: false,
  timelineRows: [],
} as unknown as UseThreadTimelineControllerResult;

async function renderThreadInLayout() {
  await renderInLayout(
    "/projects/proj_screen/threads/thr_screen",
    <div
      data-thread-window=""
      className="flex h-full min-h-0 min-w-0 flex-col overflow-clip"
    >
      <ThreadScreen
        composer={{
          environmentCheckout: undefined,
          environmentChrome: undefined,
          contextEnvironmentId: null,
          permissionPolicy: "snapshot",
        }}
        environment={null}
        presentation={{ kind: "page" }}
        projectId={THREAD.projectId}
        resolveMentionLink={() => null}
        thread={THREAD}
        timeline={TIMELINE}
        timelineHost={{
          environmentHostName: null,
          includePluginMessageActions: false,
          unreadDividerAutoScroll: false,
          unreadDividerPlacement: null,
        }}
      />
    </div>,
  );
}

function PluginPage() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="sticky top-0 border-b border-border bg-background">
        <span data-testid="plugin-page-heading">Library</span>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <p data-testid="plugin-page-text">Notes</p>
        <span className="rounded-sm bg-muted/40">3</span>
        <button type="button" className="bg-primary">
          Add
        </button>
      </div>
    </div>
  );
}

async function renderInLayout(
  route: string,
  page: ReactNode,
  navPanels: { id: string; path: string; title: string }[] = [],
) {
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      appBackdrops: [{ id: "scene", component: () => <canvas /> }],
      navPanels: navPanels.map((panel) => ({
        ...panel,
        icon: "Library",
        component: PluginPage,
      })),
    }),
  );
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  await act(async () => {
    render(
      <Wrapper>
        <CompactViewportOverrideProvider isCompactViewport={false}>
          <MemoryRouter initialEntries={[route]}>
            <AppCommandProvider>
              <AppLayout>{page}</AppLayout>
            </AppCommandProvider>
          </MemoryRouter>
        </CompactViewportOverrideProvider>
      </Wrapper>,
    );
  });
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  window.localStorage.clear();
  window.sessionStorage.clear();
  desktop.framed = false;
});

describe("bb's layout over an app backdrop", () => {
  it("reads fork.css's backdrop rules", () => {
    const rules = backdropRules();
    expect(rules.filter((rule) => rule.paints).length).toBeGreaterThan(5);
    expect(rules.some((rule) => rule.clearsSidebarToken)).toBe(true);
    for (const match of forkCss.matchAll(
      /html\[data-fork-backdrop\][^{}]*\{([^{}]*)\}/gu,
    )) {
      for (const declaration of (match[1] ?? "").matchAll(
        /(?:^|[;\s])background:\s*([^;]+);/gu,
      )) {
        expect(declaration[1]?.trim()).toMatch(
          /^(transparent|none|var\(--fork-(panel|code)\)|var\(--fork-surface-[a-z-]+-background, transparent\))$/u,
        );
      }
    }
  });

  it.each([
    ["a browser window", false],
    ["a framed macOS window", true],
  ])(
    "in %s, no layer between the window and the transcript, the composer or the thread list paints an opaque background",
    async (_name, framed) => {
      desktop.framed = framed;
      await renderThreadInLayout();
      expect(document.documentElement.hasAttribute("data-fork-backdrop")).toBe(
        true,
      );
      expect(
        document
          .querySelector('[data-testid="app-layout-root"]')
          ?.hasAttribute("data-framed"),
      ).toBe(framed);
      expect(document.querySelector('[data-sidebar="inset"]')).not.toBeNull();
      const transcript = screen.getByTestId("transcript");
      expect(transcript.closest('[data-sidebar="inset"]')).not.toBeNull();
      expect(transcript.closest("[data-page-scroll-viewport]")).not.toBeNull();
      const composer = screen.getByTestId("composer-input");
      expect(composer.closest("[data-scroll-footer]")).not.toBeNull();
      expect(opaqueLayersAbove(transcript)).toEqual([]);
      expect(opaqueLayersAbove(composer)).toEqual([]);
      expect(opaqueLayersAbove(screen.getByTestId("thread-list"))).toEqual([]);
      const fades = [
        ...document.querySelectorAll(
          '[data-sidebar="inset"] [data-overflow-fade-tone="background"]',
        ),
      ];
      const rules = backdropRules();
      for (const fade of fades) {
        expect(
          rules.some((rule) => rule.paints && fade.matches(rule.selector)),
        ).toBe(true);
      }
    },
  );

  it("finds the opaque layers when no backdrop is active", async () => {
    await renderThreadInLayout();
    act(() => {
      document.documentElement.removeAttribute("data-fork-backdrop");
    });
    expect(opaqueLayersAbove(screen.getByTestId("transcript"))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("<main[data-sidebar]"),
        "<body> base background",
      ]),
    );
  });
});

const SKILL_MARKDOWN = [
  "# Deploy",
  "",
  "Run the deploy script.",
  "",
  "```sh",
  "pnpm deploy",
  "```",
  "",
].join("\n");

function inset(): Element {
  const element = document.querySelector('[data-sidebar="inset"]');
  if (element === null) throw new Error("no main view");
  return element;
}

function setBackdropCards() {
  document.documentElement.setAttribute("data-fork-cards", "");
}

describe("bb's pages over an app backdrop", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-fork-cards");
  });

  it.each([
    ["wide", false],
    ["compact", true],
  ])(
    "the %s new-thread page paints nothing between the window and its composer",
    async (_name, isCompact) => {
      await renderInLayout(
        "/",
        <RootComposeHome
          isCompact={isCompact}
          composer={
            <form
              data-promptbox=""
              className="rounded-xl border border-border bg-background shadow-lift"
            >
              <div data-testid="composer-input" />
            </form>
          }
          compactScrollContent={<div data-testid="recents" />}
          homepageSections={<div data-testid="home-sections" />}
        />,
      );
      act(setBackdropCards);
      const composer = screen.getByTestId("composer-input");
      expect(composer.closest('[data-sidebar="inset"]')).not.toBeNull();
      expect(opaqueLayersAbove(composer)).toEqual([]);
      expect(layersIn(inset())).toEqual({ opaque: [], dense: [] });
      expect(forkCascade(composer.closest("form")!, "background")).toBe(
        SURFACE_PAINT.composer,
      );
    },
  );

  it("a settings page's section cards, badges and footer are glass panels", async () => {
    await renderInLayout(
      "/settings/general",
      <PageShell footer={<button type="button">Save</button>}>
        <SettingsSection title="Threads & editing">
          <SettingsRowList>
            <SettingsRow>
              <span data-testid="settings-text">
                Navigate to threads on creation
              </span>
              <div className="flex size-8 rounded-md bg-background" />
              <button
                type="button"
                className="border border-input bg-background shadow-xs"
              >
                Queue
              </button>
            </SettingsRow>
          </SettingsRowList>
        </SettingsSection>
      </PageShell>,
    );
    act(setBackdropCards);
    const text = screen.getByTestId("settings-text");
    const card = text.closest(".bg-card");
    expect(card).not.toBeNull();
    expect(opaqueLayersAbove(text)).toEqual([]);
    expect(layersIn(inset())).toEqual({ opaque: [], dense: [] });
    expect(forkCascade(inset(), "--card")).toBe("var(--fork-panel)");
    expect(
      forkCascade(screen.getByRole("button", { name: "Queue" }), "background"),
    ).toBe("var(--fork-panel)");
    expect(
      forkCascade(
        screen.getByRole("button", { name: "Save" }).closest(".bg-background")!,
        "background",
      ),
    ).toBe("transparent");
  });

  it("keeps switches, checkboxes, radios and sliders readable: a solid thumb on either track, a filled off state, and no outline", async () => {
    await renderInLayout(
      "/settings/general",
      <PageShell>
        <SettingsSection title="Threads & editing">
          <Switch aria-label="On" checked onCheckedChange={() => undefined} />
          <Switch
            aria-label="Off"
            checked={false}
            onCheckedChange={() => undefined}
          />
          <Checkbox aria-label="Unticked" checked={false} />
          <Checkbox aria-label="Ticked" checked />
          <RadioGroup value="a">
            <RadioGroupItem aria-label="Chosen" value="a" />
            <RadioGroupItem aria-label="Other" value="b" />
          </RadioGroup>
          <span role="slider" aria-label="Volume" className="bg-background" />
        </SettingsSection>
      </PageShell>,
    );
    const on = screen.getByRole("switch", { name: "On" });
    const off = screen.getByRole("switch", { name: "Off" });
    const thumb = (track: Element) => track.firstElementChild as Element;
    expect(thumb(on).className).toContain("bg-background");
    expect(forkCascade(thumb(on), "background-color")).toBe(
      "var(--background)",
    );
    expect(forkCascade(thumb(off), "background-color")).toBe(
      "var(--foreground)",
    );
    expect(forkCascade(screen.getByRole("slider"), "background-color")).toBe(
      "var(--background)",
    );
    expect(forkCascade(on, "background-color")).toBeNull();
    expect(forkCascade(off, "background-color")).toBeNull();
    act(setBackdropCards);
    expect(forkCascade(on, "background-color")).toBeNull();
    expect(
      forkCascade(
        screen.getByRole("checkbox", { name: "Ticked" }),
        "background-color",
      ),
    ).toBeNull();
    for (const control of [
      off,
      screen.getByRole("checkbox", { name: "Unticked" }),
      screen.getByRole("radio", { name: "Chosen" }),
      screen.getByRole("radio", { name: "Other" }),
    ]) {
      expect(forkCascade(control, "background-color")).toBe(
        "var(--fork-cards-control-off)",
      );
      expect(forkCascade(control, "border-color")).toBe("transparent");
      expect(forkCascade(control, "box-shadow")).toBe("none");
    }
    expect(
      forkCascade(document.documentElement, "--fork-cards-control-off"),
    ).toBe("color-mix(in oklab, var(--ink) 30%, transparent)");
    expect(layersIn(inset()).opaque).toEqual([]);
  });

  it("a skill page's SKILL.md panel is glass and its code block the denser code surface", async () => {
    await renderInLayout(
      "/skills/deploy",
      <PageShell>
        <SkillDetailView
          title="deploy"
          path="/home/me/.bb/skills/deploy/SKILL.md"
          files={["/home/me/.bb/skills/deploy/SKILL.md"]}
          selectedPath="/home/me/.bb/skills/deploy/SKILL.md"
          onSelectFile={() => undefined}
          contentState={{ kind: "ready", content: SKILL_MARKDOWN }}
        />
      </PageShell>,
    );
    act(setBackdropCards);
    const pre = await waitFor(() => {
      const found = inset().querySelector("pre");
      if (found === null) throw new Error(inset().textContent ?? "");
      return found;
    });
    expect(pre.textContent).toContain("pnpm deploy");
    const block = pre.parentElement!;
    expect(block.className).toContain("bg-surface-recessed");
    expect(forkCascade(block, "background")).toBe("var(--fork-code)");
    expect(opaqueLayersAbove(pre)).toEqual([]);
    expect(
      opaqueLayersAbove(screen.getByText("Run the deploy script.")),
    ).toEqual([]);
    expect(layersIn(inset())).toEqual({ opaque: [], dense: [] });
  });

  it("a plugin page's root paints nothing, its card is a panel, its sticky bar the code surface, and its primary button stays solid", async () => {
    await renderInLayout(
      "/plugins/studio/library",
      <PluginPanelView pluginId="studio" panelPath="library" subPath="" />,
      [{ id: "library", path: "library", title: "Library" }],
    );
    act(setBackdropCards);
    const text = screen.getByTestId("plugin-page-text");
    expect(text.closest('[data-sidebar="inset"]')).not.toBeNull();
    expect(opaqueLayersAbove(text)).toEqual([]);
    expect(layersIn(inset())).toEqual({
      opaque: [],
      dense: ["<button> bg-primary"],
    });
    const bar = screen.getByTestId("plugin-page-heading").parentElement!;
    expect(forkCascade(bar, "background")).toBe("var(--fork-code)");
    expect(forkCascade(bar, "backdrop-filter")).toBe("var(--fork-code-filter)");
    expect(forkCascade(text.closest(".h-full")!, "background")).toBe(
      "transparent",
    );
  });

  it("a popover outside the main view stays opaque without a card layout", async () => {
    await renderInLayout(
      "/settings/general",
      <PageShell>
        <Popover open>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent>
            <span data-testid="popover-text">Queue</span>
          </PopoverContent>
        </Popover>
      </PageShell>,
    );
    const text = await screen.findByTestId("popover-text");
    expect(text.closest('[data-sidebar="inset"]')).toBeNull();
    const content = text.closest(".bg-popover");
    expect(content).not.toBeNull();
    expect(forkCascade(content!, "background")).toBeNull();
    expect(forkCascade(content!, "--popover")).toBeNull();
    expect(layersIn(content!).dense.length).toBeGreaterThan(0);
  });

  it("with a card layout a menu, a popover, a tooltip and a dialog with a palette body are dense glass: no border, the card radius, one soft shadow, accent hover and no item outline", async () => {
    await renderInLayout(
      "/settings/general",
      <PageShell>
        <DropdownMenu open>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Copy link</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover open>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent>
            <span data-testid="popover-text">Queue</span>
            <Switch aria-label="In popover" checked />
          </PopoverContent>
        </Popover>
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Hint</TooltipTrigger>
            <TooltipContent>
              <span data-testid="tooltip-text">Archive</span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Search</DialogTitle>
            <div data-testid="palette-body" className="bg-background">
              <input className="bg-background" aria-label="Query" />
            </div>
          </DialogContent>
        </Dialog>
      </PageShell>,
    );
    act(setBackdropCards);
    const menu = await screen.findByRole("menu", { hidden: true });
    const popover = screen.getByTestId("popover-text").closest(".bg-popover")!;
    const tooltip = screen
      .getAllByTestId("tooltip-text")
      .map((text) => text.closest(".bg-primary"))
      .find((element) => element !== null)!;
    const dialog = screen
      .getByTestId("palette-body")
      .closest('[role="dialog"]')!;
    for (const overlay of [menu, popover, tooltip, dialog]) {
      expect(overlay.closest('[data-sidebar="inset"]')).toBeNull();
      expect(forkCascade(overlay, "background")).toBe("var(--fork-popover)");
      expect(forkCascade(overlay, "backdrop-filter")).toBe(
        "var(--fork-popover-filter)",
      );
      expect(forkCascade(overlay, "border-color")).toBe("transparent");
      expect(forkCascade(overlay, "border-radius")).toBe(
        "var(--fork-cards-radius)",
      );
      expect(forkCascade(overlay, "box-shadow")).toBe(
        "var(--fork-cards-shadow)",
      );
      expect(forkCascade(overlay, "color")).toBe("var(--popover-foreground)");
      expect(forkCascade(overlay, "--state-hover")).toBe(
        "var(--fork-popover-hover)",
      );
      expect(forkCascade(overlay, "--accent")).toBe(
        "var(--fork-popover-hover)",
      );
    }
    const root = document.documentElement;
    expect(forkCascade(root, "--fork-popover")).toBe(
      "var( --fork-surface-popover-background, color-mix(in oklab, var(--canvas) 76%, transparent) )",
    );
    expect(forkCascade(root, "--fork-popover-filter")).toBe(
      "var( --fork-surface-popover-backdrop-filter, blur(12px) )",
    );
    expect(forkCascade(root, "--fork-popover-hover")).toBe(
      "color-mix(in oklab, var(--primary) 24%, transparent)",
    );
    for (const inner of [
      screen.getByTestId("palette-body"),
      screen.getByRole("textbox", { name: "Query", hidden: true }),
    ]) {
      expect(forkCascade(inner, "background")).toBe("transparent");
      expect(forkCascade(inner, "backdrop-filter")).toBe("none");
    }
    const thumb = screen.getByRole("switch", {
      name: "In popover",
      hidden: true,
    }).firstElementChild as Element;
    expect(thumb.className).toContain("bg-background");
    expect(forkCascade(thumb, "background")).toBeNull();
    const item = screen.getByRole("menuitem", {
      name: "Copy link",
      hidden: true,
    });
    expect(
      forkCssRules().some(
        (rule) =>
          rule.selector.endsWith(":focus-visible") &&
          rule.declarations.get("outline") === "none" &&
          item.matches(rule.selector.replace(":focus-visible", "")),
      ),
    ).toBe(true);
    const scrim = document.querySelector('[class*="bg-black"]');
    expect(scrim).not.toBeNull();
    expect(forkCascade(scrim!, "background")).toBeNull();
  });

  it("finds a settings card as opaque when no backdrop is active", async () => {
    await renderInLayout(
      "/settings/general",
      <PageShell>
        <SettingsSection title="Links">
          <span data-testid="settings-text">Rewrite localhost links</span>
        </SettingsSection>
      </PageShell>,
    );
    act(() => {
      document.documentElement.removeAttribute("data-fork-backdrop");
    });
    expect(opaqueLayersAbove(screen.getByTestId("settings-text"))).toEqual(
      expect.arrayContaining([expect.stringContaining("bg-card")]),
    );
  });
});

const SURFACE_PAINT = {
  sidebar: "var(--fork-surface-sidebar-background, transparent)",
  main: "var(--fork-surface-main-background, transparent)",
  header: "var(--fork-surface-header-background, transparent)",
  composer: "var(--fork-surface-composer-background, transparent)",
  "secondary-panel":
    "var(--fork-surface-secondary-panel-background, transparent)",
} as const;

type CardSurface = keyof typeof SURFACE_PAINT;

function setCards(on: boolean) {
  act(() => {
    if (on) document.documentElement.setAttribute("data-fork-cards", "");
    else document.documentElement.removeAttribute("data-fork-cards");
  });
}

function one(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`Expected ${selector}`);
  return element;
}

function seeThroughContainers(): Element[] {
  return [
    one('[data-sidebar="panel"]'),
    one('[data-sidebar="sidebar"]'),
    one('[data-sidebar="collapsible-body"]'),
    one('[data-sidebar="inset"]'),
  ];
}

function expectSeeThrough(element: Element) {
  expect(["none", "transparent", null]).toContain(
    forkCascade(element, "background"),
  );
  expect(["none", null]).toContain(forkCascade(element, "backdrop-filter"));
}

function expectCard(element: Element, surface: CardSurface, radius: string) {
  expect(forkCascade(element, "background")).toBe(SURFACE_PAINT[surface]);
  expect(forkCascade(element, "backdrop-filter")).toBe(
    `var(--fork-surface-${surface}-backdrop-filter, none)`,
  );
  expect(forkCascade(element, "border-radius")).toBe(radius);
  expect(forkCascade(element, "border")).toBe("0");
  expect(forkCascade(element, "box-shadow")).toBe("var(--fork-cards-shadow)");
}

function expectColumnCard() {
  const content = one(
    '[data-sidebar="inset"] [data-thread-window] [data-page-scroll-viewport] > div',
  );
  const scroller = content.parentElement as Element;
  const column = one('[data-sidebar="inset"] [data-testid="transcript"]');
  expect(content.contains(column)).toBe(true);
  expect(column.closest('[class*="max-w-[760px]"]')).not.toBeNull();
  expect(forkCascade(document.documentElement, "--fork-cards-column")).toBe(
    "808px",
  );
  const paint = (property: string) =>
    forkCascade(content, property, "::before");
  expect(paint("background")).toBe(SURFACE_PAINT.main);
  expect(paint("backdrop-filter")).toBe(
    "var(--fork-surface-main-backdrop-filter, none)",
  );
  expect(paint("border-radius")).toBe("var(--fork-cards-radius)");
  expect(paint("border")).toBe("0");
  expect(paint("box-shadow")).toBe("var(--fork-cards-shadow)");
  expect(paint("content")).toBe('""');
  expect(paint("position")).toBe("sticky");
  expect(paint("top")).toBe("0");
  expect(paint("z-index")).toBe("-1");
  expect(paint("align-self")).toBe("center");
  expect(paint("width")).toBe("min(100%, var(--fork-cards-column))");
  expect(paint("height")).toBe("100cqh");
  expect(paint("margin-bottom")).toBe("-100cqh");
  expect(paint("pointer-events")).toBe("none");
  expect(forkCascade(content, "isolation")).toBe("isolate");
  expect(forkCascade(scroller.parentElement as Element, "container-type")).toBe(
    "size",
  );
}

function threadWindow(): Element {
  const element = screen
    .getByTestId("transcript")
    .closest("[data-thread-window]");
  if (element === null) throw new Error("Expected the thread window");
  return element;
}

function appendCard(surface: CardSurface): Element {
  const element = document.createElement("div");
  element.setAttribute("data-fork-card", surface);
  document.body.append(element);
  return element;
}

describe("bb's layout as cards over an app backdrop", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-fork-cards");
    document.documentElement.removeAttribute("data-fork-surface-edge");
    for (const element of document.querySelectorAll(
      "body > [data-fork-card]",
    )) {
      element.remove();
    }
  });

  it("paints the card rules only from the surface variables", () => {
    const cardRules = forkCssRules().filter((rule) =>
      rule.selector.includes("[data-fork-cards]"),
    );
    expect(cardRules.length).toBeGreaterThan(10);
    for (const rule of cardRules) {
      const background = rule.declarations.get("background");
      if (background === undefined) continue;
      expect(background).toMatch(
        /^(none|transparent|var\(--fork-popover\)|var\(--fork-surface-[a-z-]+-background, transparent\))$/u,
      );
    }
  });

  it.each([
    ["a browser window", false],
    ["a framed macOS window", true],
  ])(
    "in %s, the sidebar, its body and the main view paint nothing, so the scene shows in the gaps",
    async (_name, framed) => {
      desktop.framed = framed;
      await renderThreadInLayout();
      setCards(true);
      for (const element of seeThroughContainers()) {
        expectSeeThrough(element);
        expect(forkCascade(element, "border-color")).toBe("transparent");
      }
      const inset = one('[data-sidebar="inset"]');
      for (const pseudo of ["::before", "::after"] as const) {
        expect(forkCascade(inset, "background", pseudo)).toBe("none");
      }
      expect(forkCascade(inset, "clip-path")).toBe("none");
      expect(forkCascade(inset, "mask-image")).toBe("none");
      expect(forkCascade(inset, "border-radius")).toBe(
        "var(--fork-cards-radius)",
      );
      expect(forkCascade(inset, "margin")).toBe("var(--fork-cards-gap)");
      if (framed) {
        expect(forkCascade(one('[data-sidebar="inset-edge"]'), "display")).toBe(
          "none",
        );
      }
      for (const start of [
        screen.getByTestId("plugin-nav"),
        one('[data-sidebar="inset"] [data-thread-window]'),
        one('[data-sidebar="trigger"]'),
      ]) {
        for (
          let element = start.parentElement;
          element !== null;
          element = element.parentElement
        ) {
          expectSeeThrough(element);
        }
      }
      expect(opaqueLayersAbove(screen.getByTestId("transcript"))).toEqual([]);
    },
  );

  it.each([
    ["a browser window", false],
    ["a framed macOS window", true],
  ])(
    "in %s, the sidebar toggle and the composer are cards with no border, the thread's card is its 760px column plus padding and not the whole main view, the composer sits inside it, and a plugin's sections inside the sidebar paint nothing",
    async (_name, framed) => {
      desktop.framed = framed;
      await renderThreadInLayout();
      setCards(true);
      const pluginCards = document.querySelectorAll(
        '[data-fork-card="sidebar"]',
      );
      expect(pluginCards).toHaveLength(3);
      for (const card of pluginCards) {
        expect(forkCascade(card, "background")).toBe("none");
        expect(forkCascade(card, "backdrop-filter")).toBe("none");
        expect(forkCascade(card, "box-shadow")).toBe("none");
      }
      for (const surface of Object.keys(SURFACE_PAINT) as CardSurface[]) {
        expectCard(appendCard(surface), surface, "var(--fork-cards-radius)");
      }
      expectSeeThrough(threadWindow());
      expect(forkCascade(threadWindow(), "box-shadow")).toBeNull();
      expect(forkCascade(threadWindow(), "border-radius")).toBeNull();
      expectColumnCard();
      const composer = one('[data-sidebar="inset"] [data-promptbox]');
      expectCard(composer, "composer", "var(--fork-cards-radius)");
      expect(threadWindow().contains(composer)).toBe(true);
      expect(forkCascade(composer, "margin")).toBeNull();
      for (
        let element = composer.parentElement;
        element !== null && element !== threadWindow();
        element = element.parentElement
      ) {
        expectSeeThrough(element);
        expect(forkCascade(element, "box-shadow")).toBeNull();
        expect(forkCascade(element, "border")).toBeNull();
      }
      const pills = [
        ...document.querySelectorAll(
          '[data-fork-header-group], [data-sidebar="trigger"]',
        ),
      ];
      expect(pills.length).toBeGreaterThan(0);
      if (framed) {
        expect(
          one(
            '[data-testid="app-window-title-bar"] [data-fork-header-group="history"]',
          ),
        ).toBeDefined();
      }
      for (const pill of pills)
        expectCard(pill, "header", "var(--fork-cards-control-radius)");
      const panel = document.createElement("aside");
      panel.setAttribute("data-surface-tone", "sidebar");
      threadWindow().append(panel);
      expectCard(panel, "secondary-panel", "var(--fork-cards-radius)");
      expect(forkCascade(panel, "margin-left")).toBe("var(--fork-cards-gap)");
      expect(forkCascade(panel, "margin")).toBeNull();
      panel.setAttribute("inert", "");
      expect(forkCascade(panel, "margin-left")).toBeNull();
    },
  );

  it("draws no border and no surface edge on any card, and uses one radius and one gap", async () => {
    await renderThreadInLayout();
    setCards(true);
    act(() => {
      document.documentElement.setAttribute(
        "data-fork-surface-edge",
        "sidebar main header composer secondary-panel",
      );
    });
    const cardRules = forkCssRules().filter((rule) =>
      rule.selector.includes("[data-fork-cards]"),
    );
    expect(
      forkCascade(document.documentElement, "--fork-cards-control-radius"),
    ).toBe("max(0px, calc(var(--fork-cards-radius) - 2px))");
    for (const rule of cardRules) {
      for (const [property, value] of rule.declarations) {
        expect(value).not.toMatch(/--fork-surface-[a-z-]+-edge/u);
        if (property === "border") expect(value).toBe("0");
        if (/^border(-[a-z]+)?-(color|width|style)$/u.test(property)) {
          expect(value).toBe("transparent");
        }
        if (property === "border-radius") {
          expect([
            "var(--fork-cards-radius)",
            "var(--fork-cards-control-radius)",
          ]).toContain(value);
        }
        if (property.startsWith("--")) continue;
        expect(value).not.toMatch(/\b\d+(\.\d+)?px\b/u);
      }
    }
    for (const card of [
      appendCard("sidebar"),
      one("[data-promptbox]"),
      one('[data-sidebar="trigger"]'),
    ]) {
      expect(forkCascade(card, "border")).toBe("0");
    }
    expect(forkCascade(one('[data-sidebar="panel"]'), "border-color")).toBe(
      "transparent",
    );
    expect(
      forkCascade(one('[data-sidebar="inset"]'), "background", "::after"),
    ).toBe("none");
  });

  it("draws no 1px line on a card: no inset highlight, no ring, no outline, one soft wide shadow, and none on the controls inside a header pill or the composer", async () => {
    await renderThreadInLayout();
    setCards(true);
    const shadows = forkCssRules()
      .filter((rule) => rule.declarations.has("--fork-cards-shadow"))
      .map((rule) => rule.declarations.get("--fork-cards-shadow") ?? "");
    expect(shadows).toHaveLength(2);
    for (const shadow of shadows) {
      expect(shadow).not.toContain("inset");
      expect(shadow).toMatch(
        /^0 14px 40px -14px color-mix\(in oklab, var\(--(ink|canvas)\) \d+%, transparent\)$/u,
      );
    }
    for (const rule of forkCssRules()) {
      if (!rule.selector.includes("[data-fork-cards]")) continue;
      for (const [property, value] of rule.declarations) {
        if (property === "box-shadow") {
          expect(["none", "var(--fork-cards-shadow)"]).toContain(value);
        }
        if (property === "outline") expect(value).toBe("none");
        expect(property).not.toMatch(/^outline-|^--tw-ring/u);
      }
    }
    const pill = document.createElement("div");
    pill.setAttribute("data-fork-header-group", "actions");
    document.body.append(pill);
    const control = document.createElement("button");
    control.className = "border border-border shadow-xs";
    pill.append(control);
    const inComposer = document.createElement("button");
    inComposer.className = "border border-border";
    one("[data-promptbox]").append(inComposer);
    for (const element of [control, inComposer]) {
      expect(forkCascade(element, "border-color")).toBe("transparent");
      expect(forkCascade(element, "box-shadow")).toBe("none");
    }
    const bubble = document.createElement("div");
    bubble.className =
      "rounded-xl border border-border-seam bg-surface-recessed";
    one('[data-sidebar="inset"] [data-testid="transcript"]').append(bubble);
    expect(forkCascade(bubble, "border-color")).toBe("transparent");
    pill.remove();
    inComposer.remove();
    bubble.remove();
  });

  it("frosts the composer area inside the column card with a masked blur and no tint of its own, so the scene shows through at the column card's density", async () => {
    await renderThreadInLayout();
    const footer = one('[data-sidebar="inset"] [data-scroll-footer] > div');
    expect(footer.contains(one("[data-promptbox]"))).toBe(true);
    expect(forkCascade(footer, "background-image", "::before")).toBeNull();
    setCards(true);
    const paint = (property: string) =>
      forkCascade(footer, property, "::before");
    expect(paint("content")).toBe('""');
    expect(paint("position")).toBe("absolute");
    expect(paint("z-index")).toBe("-1");
    expect(paint("background-image")).toBe(
      "var(--fork-cards-composer-backing)",
    );
    expect(paint("width")).toBe("min(100%, var(--fork-cards-column))");
    expect(paint("margin-inline")).toBe("auto");
    expect(paint("inset-block")).toBe("calc(-1 * var(--fork-cards-fade)) 0");
    expect(paint("backdrop-filter")).toBe("var(--fork-cards-composer-filter)");
    expect(
      forkCascade(document.documentElement, "--fork-cards-composer-filter"),
    ).toBe("blur(18px)");
    expect(paint("mask-image")).toBe(
      "linear-gradient( to bottom, transparent, #000 var(--fork-cards-fade) )",
    );
    expect(paint("border-bottom-left-radius")).toBe("var(--fork-cards-radius)");
    expect(paint("border-bottom-right-radius")).toBe(
      "var(--fork-cards-radius)",
    );
    expect(paint("pointer-events")).toBe("none");
    expect(
      forkCascade(document.documentElement, "--fork-cards-composer-backing"),
    ).toBe("none");
    expect(footer.className).toContain("relative");
    expect(footer.parentElement?.className).toContain("sticky");
  });

  it("puts the composer's stack cards (queue, banners) on the composer's surface under cards, and leaves them alone otherwise", async () => {
    await renderThreadInLayout();
    const dock = one('[data-sidebar="inset"] [data-scroll-footer]');
    const token = () => forkCascade(dock, "--surface-raised-solid");
    expect(token()).toBeNull();
    expect(forkCascade(inset(), "--surface-raised-solid")).toBe(
      "var(--surface-raised)",
    );
    setCards(true);
    expect(token()).toBe(
      "var( --fork-surface-composer-background, var(--surface-raised) )",
    );
    const panel = document.createElement("aside");
    panel.setAttribute("data-surface-tone", "sidebar");
    const panelDock = document.createElement("div");
    panelDock.setAttribute("data-scroll-footer", "");
    panel.append(panelDock);
    document.body.append(panel);
    expect(forkCascade(panelDock, "--surface-raised-solid")).toBe(token());
    panel.remove();
    setCards(false);
    expect(token()).toBeNull();
  });

  it("hides the sidebar list's idle scrollbar thumb, which read as a seam beside the main card", async () => {
    await renderThreadInLayout();
    const list = one('[data-sidebar="content"]');
    expect(forkCascade(list, "scrollbar-color")).toBe(null);
    setCards(true);
    expect(forkCascade(list, "scrollbar-color")).toBe(
      "transparent transparent",
    );
    expect(forkCss).toMatch(
      /\[data-sidebar="content"\]:not\(:hover\)::-webkit-scrollbar-thumb \{\s*background-color: transparent;/u,
    );
  });

  it("applies none of the card rules without a card layout", async () => {
    await renderThreadInLayout();
    for (const surface of Object.keys(SURFACE_PAINT) as CardSurface[]) {
      appendCard(surface);
    }
    const cardRules = forkCssRules().filter((rule) =>
      rule.selector.includes("[data-fork-cards]"),
    );
    for (const element of document.querySelectorAll("*")) {
      for (const rule of cardRules) {
        expect(element.matches(rule.selector)).toBe(false);
      }
    }
    expect(forkCascade(one('[data-sidebar="inset"]'), "background")).toBe(
      SURFACE_PAINT.main,
    );
    expect(forkCascade(one('[data-sidebar="panel"]'), "background")).toBe(
      SURFACE_PAINT.sidebar,
    );
    expect(forkCascade(one('[data-sidebar="inset"]'), "margin")).toBe(null);
    expect(forkCascade(one('[data-fork-card="main"]'), "background")).toBe(
      null,
    );
    expect(forkCascade(threadWindow(), "background")).toBe("transparent");
  });
});

const TOOLS_VIEW = readFileSync(
  join(here, "../../views/ToolsView.tsx"),
  "utf8",
);
const RESOURCE_COLLECTION = readFileSync(
  join(
    here,
    "../../../../../packages/shared-ui/src/components/ui/resource/collection.tsx",
  ),
  "utf8",
);

function expectMainCardPaint(element: Element, pseudo: "::before" | "::after") {
  const paint = (property: string) => forkCascade(element, property, pseudo);
  expect(paint("background")).toBe(SURFACE_PAINT.main);
  expect(paint("backdrop-filter")).toBe(
    "var(--fork-surface-main-backdrop-filter, none)",
  );
  expect(paint("border")).toBe("0");
  expect(paint("box-shadow")).toBe("var(--fork-cards-shadow)");
  expect(paint("content")).toBe('""');
  expect(paint("z-index")).toBe("-1");
  expect(paint("pointer-events")).toBe("none");
}

describe("bb's pages as column cards over an app backdrop", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-fork-cards");
  });

  it("a page shell's content column is the page's one card: sticky, as tall as the page area, 40px wider each side, and the main view paints no full-page glass", async () => {
    await renderInLayout(
      "/settings/general",
      <PageShell contentClassName="pt-4 md:pt-5">
        <SettingsSection title="Threads & editing">
          <span data-testid="settings-text">Navigate to threads</span>
        </SettingsSection>
      </PageShell>,
    );
    const scroller = one('[data-sidebar="inset"] [data-page-scroll-viewport]');
    const column = scroller.firstElementChild as Element;
    expect(column.className).toContain("max-w-[760px]");
    expect(column.className).toContain("px-4");
    expect(forkCascade(column, "content", "::before")).toBeNull();
    setCards(true);
    expectSeeThrough(inset());
    expectMainCardPaint(column, "::before");
    const paint = (property: string) =>
      forkCascade(column, property, "::before");
    expect(paint("border-radius")).toBe("var(--fork-cards-radius)");
    expect(paint("position")).toBe("sticky");
    expect(paint("top")).toBe("0");
    expect(paint("align-self")).toBe("center");
    expect(paint("width")).toBe(
      "min(100cqw, calc(100% + 2 * var(--fork-cards-page-bleed)))",
    );
    expect(paint("height")).toBe("100cqh");
    expect(paint("margin-top")).toBe("calc(-1 * var(--fork-cards-page-lead))");
    expect(paint("margin-bottom")).toBe(
      "calc(var(--fork-cards-page-lead) - 100cqh)",
    );
    const root = document.documentElement;
    expect(forkCascade(root, "--fork-cards-page-bleed")).toBe("40px");
    expect(forkCascade(root, "--fork-cards-page-lead")).toBe("40px");
    expect(forkCascade(column, "isolation")).toBe("isolate");
    expect(forkCascade(scroller, "overflow-x")).toBe("hidden");
    expect(
      forkCascade(scroller.parentElement as Element, "container-type"),
    ).toBe("size");
    expect(opaqueLayersAbove(screen.getByTestId("settings-text"))).toEqual([]);
  });

  it("leaves the new-thread page and the thread's own column card alone", async () => {
    await renderInLayout(
      "/",
      <RootComposeHome
        isCompact
        composer={<form data-promptbox="" />}
        compactScrollContent={<div data-testid="recents" />}
        homepageSections={null}
      />,
    );
    setCards(true);
    const home = one('[data-sidebar="inset"] [data-page-scroll-viewport]');
    expect(forkCascade(home, "overflow-x")).toBeNull();
    expect(
      forkCascade(home.firstElementChild as Element, "content", "::before"),
    ).toBeNull();
    cleanup();
    await renderThreadInLayout();
    setCards(true);
    expectColumnCard();
    const thread = one(
      '[data-sidebar="inset"] [data-thread-window] [data-page-scroll-viewport] > div',
    );
    expect(forkCascade(thread, "margin-top", "::before")).toBeNull();
  });

  it("Skills, Plugins and the marketplace get one card of the wide column behind the toolbar and the list, and a skill's or plugin's page the same card", async () => {
    expect(TOOLS_VIEW).toContain(
      '<div className="box-border h-full w-full pb-4 pt-3 md:pt-4">',
    );
    expect(TOOLS_VIEW).toContain(
      '<div className="relative h-full overflow-hidden">\n      <ForkTitleHost kind="tools" />\n      <div ref={scrollRef} className="h-full overflow-y-auto">',
    );
    expect(RESOURCE_COLLECTION).toContain("data-resource-collection-viewport");
    expect(RESOURCE_COLLECTION).toContain("md:pr-3");
    await renderInLayout(
      "/skills",
      <>
        <div
          data-testid="collection"
          className="box-border h-full w-full pb-4 pt-3 md:pt-4"
        >
          <div className="flex h-full min-h-0 flex-col gap-5">
            <div data-resource-collection-viewport="" />
          </div>
        </div>
        <div data-testid="detail" className="relative h-full overflow-hidden">
          <div className="h-full overflow-y-auto" />
        </div>
        <div data-testid="other" className="relative h-full overflow-hidden" />
      </>,
    );
    setCards(true);
    for (const id of ["collection", "detail"]) {
      const page = screen.getByTestId(id);
      expectMainCardPaint(page, "::before");
      const paint = (property: string) =>
        forkCascade(page, property, "::before");
      expect(paint("border-radius")).toBe("var(--fork-cards-radius)");
      expect(paint("position")).toBe("absolute");
      expect(paint("inset")).toBe("0");
      expect(paint("width")).toBe("min(100%, var(--fork-cards-wide-column))");
      expect(paint("margin-inline")).toBe("auto");
      expect(forkCascade(page, "isolation")).toBe("isolate");
      expect(forkCascade(page, "position")).toBe("relative");
    }
    expect(
      forkCascade(screen.getByTestId("other"), "content", "::before"),
    ).toBeNull();
    expect(
      forkCascade(document.documentElement, "--fork-cards-wide-column"),
    ).toBe("1032px");
    expect(forkCss).toMatch(
      /@media \(width >= 48rem\) \{\s*html\[data-fork-cards\]\s*\[data-sidebar="inset"\]\s*\.box-border\.h-full\.w-full:has\(\[data-resource-collection-viewport\]\)::before \{\s*inset-inline-end: var\(--fork-cards-scroll-gutter\);/u,
    );
  });

  it("hides the idle scrollbar thumb of every scroller in the main view but the thread's own", async () => {
    await renderInLayout(
      "/settings/general",
      <PageShell>
        <div data-testid="nested" className="overflow-y-auto" />
        <div data-testid="thread" className="thread-scrollbar" />
      </PageShell>,
    );
    const scroller = one('[data-sidebar="inset"] [data-page-scroll-viewport]');
    expect(forkCascade(scroller, "scrollbar-color")).toBeNull();
    setCards(true);
    for (const element of [scroller, screen.getByTestId("nested")]) {
      expect(forkCascade(element, "scrollbar-color")).toBe(
        "transparent transparent",
      );
    }
    expect(
      forkCascade(screen.getByTestId("thread"), "scrollbar-color"),
    ).toBeNull();
    expect(forkCss).toMatch(
      /\[data-sidebar="inset"\]\s*:not\(:hover, \.thread-scrollbar\)::-webkit-scrollbar-thumb \{\s*background-color: transparent;/u,
    );
  });

  it("a filter pill group keeps its own fills: only real radios take the filled off state", async () => {
    await renderInLayout(
      "/settings/general",
      <PageShell>
        <ToggleGroup type="single" value="all" aria-label="Kind">
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="watchers">Watchers</ToggleGroupItem>
        </ToggleGroup>
        <RadioGroup value="a">
          <RadioGroupItem aria-label="Other" value="b" />
        </RadioGroup>
      </PageShell>,
    );
    setCards(true);
    for (const name of ["All", "Watchers"]) {
      const pill = screen.getByRole("radio", { name });
      expect(["on", "off"]).toContain(pill.getAttribute("data-state"));
      expect(forkCascade(pill, "background-color")).toBeNull();
    }
    expect(
      forkCascade(
        screen.getByRole("radio", { name: "Other" }),
        "background-color",
      ),
    ).toBe("var(--fork-cards-control-off)");
  });

  it("a table wider than the thread's column gets the column's glass under the two parts outside it only", async () => {
    await renderThreadInLayout();
    const content = one(
      '[data-sidebar="inset"] [data-thread-window] [data-page-scroll-viewport] > div',
    );
    const host = document.createElement("div");
    content.append(host);
    const nested = document.createElement("div");
    nested.className = "[--md-table-start-offset:0px]";
    content.append(nested);
    const markdown = "| Page | Card |\n| --- | --- |\n| Settings | 808 |";
    await act(async () => {
      render(<MarkdownPreview content={markdown} />, { container: host });
      render(<MarkdownPreview content={markdown} />, { container: nested });
    });
    const breakout = (root: Element) =>
      root.querySelector("table")!.parentElement!.parentElement as Element;
    const table = breakout(host);
    expect(table.getAttribute("style")).toContain("--md-table-breakout-max");
    expect(forkCascade(table, "content", "::before")).toBeNull();
    setCards(true);
    expect(forkCascade(table, "position")).toBe("relative");
    expect(forkCascade(table, "isolation")).toBe("isolate");
    expect(forkCascade(table, "--fork-cards-breakout")).toBe(
      "min(var(--md-content-w, 100%), 100%)",
    );
    expect(forkCascade(table, "--fork-cards-breakout-wing")).toBe(
      "max( 0px, calc((var(--fork-cards-breakout) - var(--fork-cards-column)) / 2) )",
    );
    for (const [pseudo, side, corners] of [
      ["::before", "left", ["top-left", "bottom-left"]],
      ["::after", "right", ["top-right", "bottom-right"]],
    ] as const) {
      expectMainCardPaint(table, pseudo);
      const paint = (property: string) => forkCascade(table, property, pseudo);
      expect(paint("position")).toBe("absolute");
      expect(paint("inset-block")).toBe("0");
      expect(paint("width")).toBe("var(--fork-cards-breakout-wing)");
      expect(paint(side)).toBe("calc((100% - var(--fork-cards-breakout)) / 2)");
      for (const corner of corners) {
        expect(paint(`border-${corner}-radius`)).toBe(
          "var(--fork-cards-radius)",
        );
      }
      expect(paint("border-radius")).toBeNull();
    }
    const startAligned = breakout(nested);
    expect(forkCascade(startAligned, "width", "::before")).toBe(
      "var(--fork-cards-breakout)",
    );
    expect(forkCascade(startAligned, "left", "::before")).toBe("0");
    expect(forkCascade(startAligned, "content", "::after")).toBe("none");
  });
});
