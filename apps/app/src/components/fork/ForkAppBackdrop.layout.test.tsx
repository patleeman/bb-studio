// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render, screen } from "@testing-library/react";
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
            <div data-testid="thread-list" />
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
  if (!/^bg-sidebar(\/|$)/u.test(utilityOf(paint.utility).utility)) {
    return false;
  }
  return rules.some(
    (rule) =>
      rule.clearsSidebarToken &&
      rule.pseudo === "" &&
      paint.element.closest(rule.selector) !== null,
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
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      appBackdrops: [{ id: "scene", component: () => <canvas /> }],
    }),
  );
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  await act(async () => {
    render(
      <Wrapper>
        <CompactViewportOverrideProvider isCompactViewport={false}>
          <MemoryRouter
            initialEntries={["/projects/proj_screen/threads/thr_screen"]}
          >
            <AppCommandProvider>
              <AppLayout>
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
                </div>
              </AppLayout>
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
          /^(transparent|none|var\(--fork-surface-[a-z-]+-background, transparent\))$/u,
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
