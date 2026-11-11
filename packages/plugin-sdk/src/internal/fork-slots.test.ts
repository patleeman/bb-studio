import { describe, expect, it } from "vitest";
import type { PluginAppBuilder } from "../app-contract.js";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

function collect(setup: (app: PluginAppBuilder) => void) {
  return collectPluginAppRegistrations({ __bbPluginApp: true, setup });
}

describe("slots.experimental_messageAction", () => {
  it("keeps the item's title, icon, availability, run and a known replaced item", () => {
    const isAvailable = () => true;
    const run = () => {};
    const collected = collect((app) => {
      app.slots.experimental_messageAction({
        id: "fork-here",
        title: "Fork conversation from here",
        icon: "Fork",
        isAvailable,
        run,
      });
      app.slots.experimental_messageAction({
        id: "plain",
        title: "Plain",
        run,
      });
      app.slots.experimental_messageAction({
        id: "replaces",
        title: "Replaces",
        run,
        experimental_replaces: "thread.fork",
      });
      app.slots.experimental_messageAction({
        id: "unknown",
        title: "Unknown",
        run,
        experimental_replaces: "thread.other",
      } as never);
    });
    expect(collected.forkMessageActions).toEqual([
      {
        id: "fork-here",
        title: "Fork conversation from here",
        icon: "Fork",
        isAvailable,
        run,
      },
      { id: "plain", title: "Plain", run },
      {
        id: "replaces",
        title: "Replaces",
        run,
        experimental_replaces: "thread.fork",
      },
      { id: "unknown", title: "Unknown", run },
    ]);
  });

  it("rejects a missing run, a non-function isAvailable, an empty title and a repeated id", () => {
    const run = () => {};
    expect(() =>
      collect((app) =>
        app.slots.experimental_messageAction({
          id: "a",
          title: "A",
        } as never),
      ),
    ).toThrow(/run must be a function/u);
    expect(() =>
      collect((app) =>
        app.slots.experimental_messageAction({
          id: "a",
          title: "A",
          isAvailable: true,
          run,
        } as never),
      ),
    ).toThrow(/isAvailable must be a function/u);
    expect(() =>
      collect((app) =>
        app.slots.experimental_messageAction({ id: "a", title: "", run }),
      ),
    ).toThrow();
    expect(() =>
      collect((app) => {
        app.slots.experimental_messageAction({ id: "a", title: "A", run });
        app.slots.experimental_messageAction({ id: "a", title: "B", run });
      }),
    ).toThrow();
  });
});

describe("experimental_threadList experimental_hideSidebarHeader", () => {
  it("passes the flag through only when it is true", () => {
    const component = () => null;
    const collected = collect((app) => {
      app.slots.experimental_threadList({
        id: "everything",
        title: "Everything",
        component,
        experimental_hideSidebarHeader: true,
      });
      app.slots.experimental_threadList({
        id: "plain",
        title: "Plain",
        component,
        experimental_hideSidebarHeader: "yes" as never,
      });
    });
    expect(collected.threadLists).toEqual([
      {
        id: "everything",
        title: "Everything",
        component,
        experimental_hideSidebarHeader: true,
      },
      { id: "plain", title: "Plain", component },
    ]);
  });
});

describe("slots.experimental_threadHeader", () => {
  it("keeps the decoration hook and rejects a missing hook or a repeated id", () => {
    const useDecoration = () => null;
    const collected = collect((app) => {
      app.slots.experimental_threadHeader({ id: "chat", useDecoration });
    });
    expect(collected.threadHeaders).toEqual([{ id: "chat", useDecoration }]);
    expect(() =>
      collect((app) =>
        app.slots.experimental_threadHeader({ id: "chat" } as never),
      ),
    ).toThrow(/useDecoration must be a function/u);
    expect(() =>
      collect((app) => {
        app.slots.experimental_threadHeader({ id: "chat", useDecoration });
        app.slots.experimental_threadHeader({ id: "chat", useDecoration });
      }),
    ).toThrow();
  });
});

describe("experimental_threadList experimental_useSidebarStyle", () => {
  it("keeps the hook and rejects a value that is not a function", () => {
    const component = () => null;
    const useSidebarStyle = () => ({ background: "red" });
    const collected = collect((app) => {
      app.slots.experimental_threadList({
        id: "bots",
        title: "Bots",
        component,
        experimental_useSidebarStyle: useSidebarStyle,
      });
    });
    expect(collected.threadLists).toEqual([
      {
        id: "bots",
        title: "Bots",
        component,
        experimental_useSidebarStyle: useSidebarStyle,
      },
    ]);
    expect(() =>
      collect((app) =>
        app.slots.experimental_threadList({
          id: "bots",
          title: "Bots",
          component,
          experimental_useSidebarStyle: { background: "red" } as never,
        }),
      ),
    ).toThrow(/experimental_useSidebarStyle" must be a function/u);
  });
});

describe("slots.experimental_skillSource", () => {
  it("keeps the label and hook, and rejects a missing hook, an empty label and a repeated id", () => {
    const useSkills = () => [];
    const collected = collect((app) => {
      app.slots.experimental_skillSource({
        id: "chief-of-staff",
        label: "Chief of Staff",
        useSkills,
      });
    });
    expect(collected.skillSources).toEqual([
      { id: "chief-of-staff", label: "Chief of Staff", useSkills },
    ]);
    expect(() =>
      collect((app) =>
        app.slots.experimental_skillSource({ id: "a", label: "A" } as never),
      ),
    ).toThrow(/useSkills must be a function/u);
    expect(() =>
      collect((app) =>
        app.slots.experimental_skillSource({ id: "a", label: "", useSkills }),
      ),
    ).toThrow();
    expect(() =>
      collect((app) => {
        app.slots.experimental_skillSource({ id: "a", label: "A", useSkills });
        app.slots.experimental_skillSource({ id: "a", label: "B", useSkills });
      }),
    ).toThrow();
  });
});

describe("slots.experimental_newTabItems", () => {
  it("keeps the title and the hooks given, and rejects a registration with neither", () => {
    const useRecents = () => [];
    const search = () => Promise.resolve([]);
    const collected = collect((app) => {
      app.slots.experimental_newTabItems({
        id: "pages",
        title: "Pages",
        useRecents,
      });
      app.slots.experimental_newTabItems({
        id: "boards",
        title: "Boards",
        search,
      });
    });
    expect(collected.newTabItems).toEqual([
      { id: "pages", title: "Pages", useRecents },
      { id: "boards", title: "Boards", search },
    ]);
    expect(() =>
      collect((app) =>
        app.slots.experimental_newTabItems({ id: "a", title: "A" }),
      ),
    ).toThrow(/give useRecents, search or both/u);
    expect(() =>
      collect((app) =>
        app.slots.experimental_newTabItems({
          id: "a",
          title: "A",
          search: "nope",
        } as never),
      ),
    ).toThrow(/search must be a function/u);
  });
});

describe("experimental_tab experimental_showInNewTab", () => {
  const component = () => null;
  const tab = {
    title: "Bot",
    icon: "Bot",
    component,
    context: { kind: "thread" },
    availability: "action",
  } as const;

  it("keeps false on an action tab and leaves the field out by default", () => {
    const collected = collect((app) => {
      app.slots.experimental_tab({
        ...tab,
        id: "hidden",
        experimental_showInNewTab: false,
      });
      app.slots.experimental_tab({ ...tab, id: "plain" });
    });
    expect(
      collected.tabs.map((entry) => [
        entry.id,
        entry.experimental_showInNewTab,
      ]),
    ).toEqual([
      ["hidden", false],
      ["plain", undefined],
    ]);
    expect(Object.hasOwn(collected.tabs[1]!, "experimental_showInNewTab")).toBe(
      false,
    );
  });

  it("rejects any other value", () => {
    for (const value of [true, "no", 0]) {
      expect(() =>
        collect((app) =>
          app.slots.experimental_tab({
            ...tab,
            id: "bad",
            experimental_showInNewTab: value as never,
          }),
        ),
      ).toThrow(/experimental_showInNewTab" must be false when set/u);
    }
  });
});

describe("experimental_tab experimental_newTabGroup and experimental_openableByPlugins", () => {
  const component = () => null;
  const tab = {
    title: "Run",
    icon: "Workflow",
    component,
    context: { kind: "thread" },
    availability: "action",
  } as const;

  it("keeps a group name and true on an action tab and leaves both out by default", () => {
    const collected = collect((app) => {
      app.slots.experimental_tab({
        ...tab,
        id: "run",
        experimental_newTabGroup: "Open",
        experimental_openableByPlugins: true,
      });
      app.slots.experimental_tab({ ...tab, id: "plain" });
    });
    expect(
      collected.tabs.map((entry) => [
        entry.id,
        entry.experimental_newTabGroup,
        entry.experimental_openableByPlugins,
      ]),
    ).toEqual([
      ["run", "Open", true],
      ["plain", undefined, undefined],
    ]);
    expect(Object.hasOwn(collected.tabs[1]!, "experimental_newTabGroup")).toBe(
      false,
    );
    expect(
      Object.hasOwn(collected.tabs[1]!, "experimental_openableByPlugins"),
    ).toBe(false);
  });

  it("rejects an empty or non-string group and any openable value but true", () => {
    for (const value of ["", 3]) {
      expect(() =>
        collect((app) =>
          app.slots.experimental_tab({
            ...tab,
            id: "bad",
            experimental_newTabGroup: value as never,
          }),
        ),
      ).toThrow(/experimental_newTabGroup" must be a non-empty string/u);
    }
    for (const value of [false, "yes", 1]) {
      expect(() =>
        collect((app) =>
          app.slots.experimental_tab({
            ...tab,
            id: "bad",
            experimental_openableByPlugins: value as never,
          }),
        ),
      ).toThrow(/experimental_openableByPlugins" must be true when set/u);
    }
  });
});
