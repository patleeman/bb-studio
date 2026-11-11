// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type AppCommandId,
  type AppKeybinding,
} from "@bb/domain";
import type { ExperimentalCommandPaletteProps } from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  AppCommandProvider,
  useAppCommandHandler,
  useAppCommandRunner,
} from "./AppCommandProvider";
import { CommandPalette } from "./CommandPalette";
import { usePluginAppCommands } from "./ForkCommandPalette";

const calls = vi.hoisted(() => [] as string[]);

function binding(
  command: AppCommandId,
  key: string,
  shift: boolean,
): AppKeybinding {
  return {
    command,
    desktopOnly: false,
    shortcut: {
      key,
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  };
}

const BINDINGS = [
  binding("palette.open", "p", true),
  binding("thread.search", "k", false),
  binding("thread.new", "o", true),
];

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      keybindingOverrides: [],
      keybindings: BINDINGS,
      defaultKeybindings: BINDINGS,
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({ getBbDesktopInfo: () => null }));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({ accessState: "unavailable" }),
}));

vi.mock("@/lib/app-query-client", () => ({
  appQueryClient: { fetchQuery: () => Promise.resolve([]) },
}));

function Handler({ command }: { command: AppCommandId }) {
  useAppCommandHandler(command, () => {
    calls.push(command);
    return true;
  });
  return null;
}

let rail: ReturnType<typeof useAppCommandRunner> | null = null;

function RailSearch() {
  rail = useAppCommandRunner();
  return null;
}

function Omni({ initialMode, close }: ExperimentalCommandPaletteProps) {
  const commands = usePluginAppCommands();
  return (
    <div data-testid="omni" data-mode={initialMode}>
      {commands.map((command) => (
        <button
          key={command.id}
          type="button"
          data-command={command.id}
          data-group={command.group}
          data-shortcut={command.shortcut ?? ""}
          onClick={command.run}
        >
          {command.title}
        </button>
      ))}
      <button
        type="button"
        onClick={() => close(() => calls.push("after close"))}
      >
        Done
      </button>
    </div>
  );
}

function Field({ experimental_onEscape }: ExperimentalCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const current = useRef(query);
  current.current = query;
  useEffect(
    () =>
      experimental_onEscape(() => {
        if (current.current === "") return false;
        setQuery("");
        return true;
      }),
    [experimental_onEscape],
  );
  return (
    <input
      aria-label="Query"
      autoFocus
      value={query}
      onChange={(event) => setQuery(event.target.value)}
    />
  );
}

function Throwing({ experimental_onEscape }: ExperimentalCommandPaletteProps) {
  useEffect(
    () =>
      experimental_onEscape(() => {
        throw new Error("escape failed");
      }),
    [experimental_onEscape],
  );
  return <div data-testid="throwing" />;
}

function Broken(): never {
  throw new Error("broken palette");
}

function Outside() {
  const commands = usePluginAppCommands();
  return <div data-testid="outside">{commands.map((c) => c.id).join(",")}</div>;
}

function renderPalette(children?: React.ReactNode) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppCommandProvider>
          <button type="button" data-testid="origin">
            origin
          </button>
          <Handler command="thread.new" />
          <RailSearch />
          <CommandPalette threadId={null} projectId={null} />
          {children}
        </AppCommandProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  screen.getByTestId("origin").focus();
}

function press(key: string, shift: boolean) {
  (document.activeElement ?? window).dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      ctrlKey: true,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function register(pluginId: string, component = Omni, id = "omni") {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({ commandPalettes: [{ id, component }] }),
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  calls.length = 0;
  rail = null;
  vi.restoreAllMocks();
});

describe("a plugin's replacement palette", () => {
  it("leaves bb's palette in place when no plugin registers one", async () => {
    renderPalette();
    act(() => press("p", true));
    const palette = await screen.findByTestId("command-palette");
    expect(screen.queryByTestId("omni")).toBeNull();
    expect(palette.querySelector("input")).not.toBeNull();
  });

  it("opens in bb's palette dialog on every entry point, with the mode of the one used", async () => {
    register("alpha");
    renderPalette();

    act(() => press("p", true));
    const omni = await screen.findByTestId("omni");
    expect(omni.dataset.mode).toBe("commands");
    expect(screen.getByTestId("command-palette").contains(omni)).toBe(true);
    expect(screen.queryByRole("combobox")).toBeNull();

    act(() => press("k", false));
    await waitFor(() =>
      expect(screen.getByTestId("omni").dataset.mode).toBe("search"),
    );

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByTestId("omni")).toBeNull());

    act(() => {
      rail?.dispatch("thread.search", null);
    });
    expect((await screen.findByTestId("omni")).dataset.mode).toBe("search");
  });

  it("clears the query on the first Escape when its handler claims it, and closes on the next", async () => {
    register("alpha", Field);
    renderPalette();
    act(() => press("p", true));
    const field = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "Query",
    });
    fireEvent.change(field, { target: { value: "road" } });
    const first = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      field.dispatchEvent(first);
    });
    expect(first.defaultPrevented).toBe(true);
    expect(screen.getByTestId("command-palette")).toBeTruthy();
    expect(field.value).toBe("");

    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("command-palette")).toBeNull(),
    );
  });

  it("closes on Escape when the handler throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    register("alpha", Throwing);
    renderPalette();
    act(() => press("p", true));
    await screen.findByTestId("throwing");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByTestId("command-palette")).toBeNull(),
    );
  });

  it("is the first registration by plugin id", async () => {
    register("zeta", () => <div data-testid="zeta" />, "z");
    register("alpha");
    renderPalette();
    act(() => press("p", true));
    expect(await screen.findByTestId("omni")).toBeTruthy();
    expect(screen.queryByTestId("zeta")).toBeNull();
  });

  it("closes, then runs what close was given", async () => {
    register("alpha");
    renderPalette();
    act(() => press("p", true));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.queryByTestId("command-palette")).toBeNull(),
    );
    await waitFor(() => expect(calls).toEqual(["after close"]));
  });

  it("lists bb's commands and runs a chosen one after the palette closes", async () => {
    register("alpha");
    renderPalette();
    act(() => press("p", true));
    const newThread = await screen.findByRole("button", {
      name: "New conversation",
    });
    expect(newThread.dataset.command).toBe("app:thread.new");
    expect(newThread.dataset.group).toBe("Threads");
    expect(newThread.dataset.shortcut).not.toBe("");
    expect(
      document.querySelector('[data-command^="settings:"]'),
    ).not.toBeNull();
    fireEvent.click(newThread);
    await waitFor(() =>
      expect(screen.queryByTestId("command-palette")).toBeNull(),
    );
    await waitFor(() => expect(calls).toEqual(["thread.new"]));
  });

  it("shows bb's palette when the plugin's component crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    register("alpha", Broken);
    renderPalette();
    act(() => press("p", true));
    const palette = await screen.findByTestId("command-palette");
    await waitFor(() => expect(palette.querySelector("input")).not.toBeNull());
  });
});

describe("experimental_useAppCommands outside the palette", () => {
  it("lists the commands available once the window has mounted", async () => {
    renderPalette(<Outside />);
    const ids = screen.getByTestId("outside").textContent?.split(",") ?? [];
    expect(ids).toContain("app:thread.new");
    expect(ids.some((id) => id.startsWith("settings:"))).toBe(true);
  });
});
