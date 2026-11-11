// @vitest-environment jsdom

import type {
  ExperimentalDragItem,
  ExperimentalItemDropTarget,
} from "@get-bb/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
} from "./fixed-panel-tabs-state";
import {
  beginPointerItemDrag,
  getCurrentDragItem,
  insertComposerMention,
  insertComposerThreadMention,
  installItemDropHost,
  ITEM_DRAG_TYPE,
  ITEM_DROP_ATTRIBUTE,
  ITEM_DROP_INDICATOR_ATTRIBUTE,
  panelTabDragItem,
  readDragItem,
  resolveItemDropZone,
  setCurrentDragItem,
  threadIdOfElement,
  writeDragItem,
  type ItemDropEnvironment,
} from "./fork-item-drag";
import type { PluginItemDropSlot } from "./fork-slots";
import {
  clearComposerEditorBridge,
  publishComposerEditorBridge,
  type ComposerEditorBridge,
} from "./composer-editor-registry";
import type { PromptDraftState } from "@bb/client-core";

class FakeDataTransfer {
  dropEffect = "none";
  private readonly data = new Map<string, string>();
  hidden = false;

  get types(): string[] {
    return [...this.data.keys()];
  }

  setData(type: string, value: string): void {
    this.data.set(type, value);
  }

  getData(type: string): string {
    return this.hidden ? "" : (this.data.get(type) ?? "");
  }
}

class FakeDragEvent extends MouseEvent {
  readonly dataTransfer: FakeDataTransfer | null;

  constructor(
    type: string,
    init: MouseEventInit & { dataTransfer?: FakeDataTransfer | null } = {},
  ) {
    super(type, init);
    this.dataTransfer = init.dataTransfer ?? null;
  }
}

function transfer(entries: Record<string, string>): FakeDataTransfer {
  const data = new FakeDataTransfer();
  for (const [type, value] of Object.entries(entries)) {
    data.setData(type, value);
  }
  return data;
}

function asDataTransfer(data: FakeDataTransfer): DataTransfer {
  return data as unknown as DataTransfer;
}

function fire(
  type: string,
  target: Element,
  data: FakeDataTransfer,
  relatedTarget: Element | null = null,
  point: { x: number; y: number } = { x: 0, y: 0 },
): FakeDragEvent {
  const event = new FakeDragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer: data,
    relatedTarget,
    clientX: point.x,
    clientY: point.y,
  });
  target.dispatchEvent(event);
  return event;
}

const thread: ExperimentalDragItem = {
  kind: "thread",
  id: "thr_9",
  title: "Fix login",
  path: "/threads/thr_9",
};

function handler(
  overrides: Partial<PluginItemDropSlot> & { pluginId: string },
): PluginItemDropSlot {
  return {
    id: "drop",
    generation: 1,
    canDrop: () => true,
    drop: () => {},
    ...overrides,
  };
}

function mountApp(): {
  composer: HTMLElement;
  composerInput: HTMLElement;
  panel: HTMLElement;
  panelBody: HTMLElement;
  strip: HTMLElement;
  shell: HTMLElement;
  timeline: HTMLElement;
  sidebar: HTMLElement;
} {
  document.body.innerHTML = `
    <div id="root">
      <aside id="sidebar" data-surface-tone="sidebar"><a id="row">Row</a></aside>
      <div data-app-content-shell="">
        <div data-split-pane-id="pane_a">
          <div id="timeline">Messages</div>
          <div data-composer-box=""><div id="input" contenteditable="true"></div></div>
        </div>
        <aside id="panel" data-surface-tone="sidebar">
          <div data-testid="thread-secondary-panel-top-chrome">
            <div data-testid="secondary-panel-tab-strip" id="strip"></div>
          </div>
          <div id="panel-body">Preview</div>
        </aside>
      </div>
    </div>`;
  const find = (selector: string) =>
    document.querySelector<HTMLElement>(selector)!;
  return {
    composer: find("[data-composer-box]"),
    composerInput: find("#input"),
    panel: find("#panel"),
    panelBody: find("#panel-body"),
    strip: find("#strip"),
    shell: find("[data-app-content-shell]"),
    timeline: find("#timeline"),
    sidebar: find("#row"),
  };
}

function installHost(
  handlers: readonly PluginItemDropSlot[],
  overrides: Partial<ItemDropEnvironment> = {},
): () => void {
  return installItemDropHost(document, {
    handlers: () => handlers,
    threadIdOf: () => "thr_1",
    insertText: () => true,
    insertMention: () => true,
    insertThreadMention: () => true,
    ...overrides,
  });
}

let dispose: (() => void) | null = null;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  dispose?.();
  dispose = null;
  setCurrentDragItem(null);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("resolveItemDropZone", () => {
  it("names the composer, the side panel and the rest of the main view", () => {
    const app = mountApp();
    expect(resolveItemDropZone(app.composerInput)).toEqual({
      zone: "composer",
      element: app.composer,
    });
    expect(resolveItemDropZone(app.strip)).toEqual({
      zone: "workbench",
      element: app.panel,
    });
    expect(resolveItemDropZone(app.panelBody)).toEqual({
      zone: "workbench",
      element: app.panel,
    });
    expect(resolveItemDropZone(app.timeline)).toEqual({
      zone: "main",
      element: app.shell,
    });
  });

  it("is not a zone outside the content shell, such as the left sidebar", () => {
    const app = mountApp();
    expect(resolveItemDropZone(app.sidebar)).toBeNull();
    expect(resolveItemDropZone(document)).toBeNull();
  });

  it("resolves a text node through its parent", () => {
    const app = mountApp();
    expect(resolveItemDropZone(app.panelBody.firstChild)?.zone).toBe(
      "workbench",
    );
  });
});

describe("threadIdOfElement", () => {
  const panes = [
    { id: "pane_a", threadId: "thr_a", focused: false },
    { id: "pane_b", threadId: null, focused: true },
  ];

  it("uses the route when the workspace is not split", () => {
    const app = mountApp();
    expect(threadIdOfElement(app.composer, [], "thr_route")).toBe("thr_route");
  });

  it("uses the pane that contains the element", () => {
    const app = mountApp();
    expect(threadIdOfElement(app.composer, panes, "thr_route")).toBe("thr_a");
  });

  it("skips pane ids it does not know and falls back to the focused pane", () => {
    const app = mountApp();
    app.panel.setAttribute("data-split-pane-id", "sidebar-pane");
    expect(threadIdOfElement(app.panelBody, panes, "thr_route")).toBeNull();
    expect(
      threadIdOfElement(
        app.panelBody,
        [{ id: "pane_a", threadId: "thr_a", focused: true }],
        "thr_route",
      ),
    ).toBe("thr_a");
  });
});

describe("the drag payload", () => {
  it("round-trips an item and remembers it for the protected dragover read", () => {
    const data = new FakeDataTransfer();
    writeDragItem(asDataTransfer(data), thread);
    expect(data.types).toEqual([ITEM_DRAG_TYPE]);
    expect(readDragItem(asDataTransfer(data))).toEqual(thread);
    data.hidden = true;
    expect(readDragItem(asDataTransfer(data))).toEqual(thread);
    window.dispatchEvent(new Event("dragend"));
    expect(getCurrentDragItem()).toBeNull();
    expect(readDragItem(asDataTransfer(data))).toBeNull();
  });

  it("rejects malformed payloads", () => {
    for (const raw of [
      "nope",
      "[]",
      '{"kind":"folder","id":"a","title":"A"}',
      '{"kind":"doc","id":"","title":"A"}',
      '{"kind":"tab","id":"a","title":"A","tab":{"pluginId":"p"}}',
    ]) {
      expect(
        readDragItem(asDataTransfer(transfer({ [ITEM_DRAG_TYPE]: raw }))),
      ).toBeNull();
    }
    expect(() =>
      writeDragItem(asDataTransfer(new FakeDataTransfer()), {
        ...thread,
        id: "",
      }),
    ).toThrow(/not a drag item/);
  });

  it("describes a plugin action tab and nothing else", () => {
    const page = createPluginPanelFixedPanelTab({
      pluginId: "studio",
      actionId: "page",
      paramsJson: '{"page":"p1"}',
      title: "Launch plan",
    });
    expect(
      panelTabDragItem({ tab: page, label: "Launch plan" }, "thr_1"),
    ).toEqual({
      kind: "tab",
      id: page.id,
      title: "Launch plan",
      pluginId: "studio",
      tab: {
        pluginId: "studio",
        tabId: "page",
        params: { page: "p1" },
        threadId: "thr_1",
      },
    });
    expect(
      panelTabDragItem({ tab: page, label: "Launch plan" }, "root-compose")?.tab
        ?.threadId,
    ).toBeNull();
    expect(
      panelTabDragItem(
        { tab: page, label: "Launch plan", isPinned: true },
        "t",
      ),
    ).toBeNull();
    expect(
      panelTabDragItem(
        {
          tab: createTerminalFixedPanelTab({ terminalId: "term_1" }),
          label: "Terminal",
        },
        "thr_1",
      ),
    ).toBeNull();
  });
});

describe("installItemDropHost", () => {
  const itemData = () => transfer({ [ITEM_DRAG_TYPE]: JSON.stringify(thread) });

  it("ignores file drags and bb's own drags", () => {
    const app = mountApp();
    const canDrop = vi.fn(() => true);
    const drop = vi.fn();
    dispose = installHost([handler({ pluginId: "studio", canDrop, drop })]);
    for (const data of [
      transfer({ Files: "" }),
      transfer({ "text/plain": "tab_1" }),
    ]) {
      expect(fire("dragover", app.composerInput, data).defaultPrevented).toBe(
        false,
      );
      expect(fire("drop", app.composerInput, data).defaultPrevented).toBe(
        false,
      );
    }
    expect(canDrop).not.toHaveBeenCalled();
    expect(drop).not.toHaveBeenCalled();
    expect(app.composer.hasAttribute(ITEM_DROP_ATTRIBUTE)).toBe(false);
  });

  it("asks handlers in plugin-id order and drops on the first that accepts", () => {
    const app = mountApp();
    const asked: string[] = [];
    const dropped: [string, ExperimentalItemDropTarget][] = [];
    const make = (pluginId: string, accepts: boolean) =>
      handler({
        pluginId,
        canDrop: () => {
          asked.push(pluginId);
          return accepts;
        },
        drop: (_item, target) => {
          dropped.push([pluginId, target]);
        },
      });
    dispose = installHost([
      make("zeta", true),
      make("beta", true),
      make("alpha", false),
    ]);
    const event = fire("drop", app.panelBody, itemData());
    expect(asked).toEqual(["alpha", "beta"]);
    expect(dropped).toEqual([
      ["beta", { zone: "workbench", threadId: "thr_1" }],
    ]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("contains a throwing canDrop and a failing drop", async () => {
    const app = mountApp();
    const drop = vi.fn(() => Promise.reject(new Error("boom")));
    dispose = installHost([
      handler({
        pluginId: "alpha",
        canDrop: () => {
          throw new Error("bad");
        },
      }),
      handler({ pluginId: "beta", drop }),
    ]);
    expect(() => fire("drop", app.timeline, itemData())).not.toThrow();
    expect(drop).toHaveBeenCalledWith(thread, { zone: "main" });
    await Promise.resolve();
    await Promise.resolve();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("refuses the drag when no handler accepts", () => {
    const app = mountApp();
    dispose = installHost([
      handler({ pluginId: "studio", canDrop: () => false }),
    ]);
    const data = itemData();
    expect(fire("dragover", app.timeline, data).defaultPrevented).toBe(false);
    expect(data.dropEffect).toBe("none");
    expect(app.shell.hasAttribute(ITEM_DROP_ATTRIBUTE)).toBe(false);
  });

  it("allows a drag from another window when a handler exists, and decides on drop", () => {
    const app = mountApp();
    const canDrop = vi.fn(() => false);
    dispose = installHost([handler({ pluginId: "studio", canDrop })]);
    const data = itemData();
    data.hidden = true;
    expect(fire("dragover", app.timeline, data).defaultPrevented).toBe(true);
    expect(canDrop).not.toHaveBeenCalled();
    data.hidden = false;
    expect(fire("drop", app.timeline, data).defaultPrevented).toBe(false);
    expect(canDrop).toHaveBeenCalledTimes(1);
    dispose();
    dispose = installHost([]);
    data.hidden = true;
    expect(fire("dragover", app.timeline, data).defaultPrevented).toBe(false);
  });

  it("marks the zone under the drag and clears the mark when it leaves, drops or ends", () => {
    const app = mountApp();
    dispose = installHost([handler({ pluginId: "studio" })]);
    const data = itemData();
    const marked = () =>
      [...document.querySelectorAll(`[${ITEM_DROP_ATTRIBUTE}]`)].map(
        (element) => element.id || element.tagName,
      );

    expect(fire("dragover", app.composerInput, data).defaultPrevented).toBe(
      true,
    );
    expect(data.dropEffect).toBe("copy");
    expect(app.composer.getAttribute(ITEM_DROP_ATTRIBUTE)).toBe("over");

    fire("dragleave", app.composerInput, data, app.composer);
    expect(app.composer.hasAttribute(ITEM_DROP_ATTRIBUTE)).toBe(true);

    fire("dragover", app.panelBody, data);
    expect(marked()).toEqual(["panel"]);

    fire("dragleave", app.panelBody, data, app.sidebar);
    expect(marked()).toEqual([]);

    fire("dragover", app.timeline, data);
    expect(app.shell.hasAttribute(ITEM_DROP_ATTRIBUTE)).toBe(true);
    fire("drop", app.timeline, data);
    expect(marked()).toEqual([]);

    fire("dragover", app.timeline, data);
    fire("dragend", app.sidebar, data);
    expect(marked()).toEqual([]);

    fire("dragover", app.timeline, data);
    dispose();
    dispose = null;
    expect(marked()).toEqual([]);
  });

  it("leaves a drag alone once a plugin's own target accepted it", () => {
    const app = mountApp();
    const drop = vi.fn();
    dispose = installHost([handler({ pluginId: "studio", drop })]);
    const accept = (event: Event) => event.preventDefault();
    app.timeline.addEventListener("dragover", accept);
    app.timeline.addEventListener("drop", accept);
    const data = itemData();
    fire("dragover", app.timeline, data);
    expect(app.shell.hasAttribute(ITEM_DROP_ATTRIBUTE)).toBe(false);
    fire("drop", app.timeline, data);
    expect(drop).not.toHaveBeenCalled();
  });

  it("gives the composer zone its thread and an insertText bound to it", () => {
    const app = mountApp();
    const insertText = vi.fn(() => true);
    let seen: ExperimentalItemDropTarget | null = null;
    dispose = installHost(
      [
        handler({
          pluginId: "studio",
          drop: (_item, target) => {
            seen = target;
            if (target.zone === "composer") target.insertText("@Fix login ");
          },
        }),
      ],
      { threadIdOf: () => null, insertText },
    );
    fire("drop", app.composerInput, itemData());
    expect(seen).toMatchObject({ zone: "composer", threadId: null });
    expect(insertText).toHaveBeenCalledWith(null, "@Fix login ");
  });
});

describe("a drop in a side panel with panes", () => {
  const itemData = () => transfer({ [ITEM_DRAG_TYPE]: JSON.stringify(thread) });

  function place(element: Element, left: number, width: number): void {
    element.getBoundingClientRect = () =>
      ({
        left,
        right: left + width,
        top: 0,
        bottom: element.id === "panel" ? 600 : 30,
        width,
        height: element.id === "panel" ? 600 : 30,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  function pane(paneId: string, labels: string[]): string {
    return `
      <div data-split-pane-id="${paneId}">
        <div data-testid="thread-secondary-panel-top-chrome">
          <div data-sidebar-split-tab-group="${paneId}">
            ${labels.map((label) => `<div data-tab-pill="" id="${label}"><button>${label}</button></div>`).join("")}
          </div>
        </div>
        <div id="body-${paneId}">Preview</div>
      </div>`;
  }

  function mountPanes(panes: [string, string[], number][]): HTMLElement {
    document.body.innerHTML = `
      <div data-app-content-shell="">
        <aside id="panel">${panes.map(([id, labels]) => pane(id, labels)).join("")}</aside>
      </div>`;
    const panel = document.getElementById("panel")!;
    place(panel, 0, 400);
    for (const [id, labels, left] of panes) {
      place(
        document.querySelector(`[data-sidebar-split-tab-group="${id}"]`)!,
        left,
        200,
      );
      labels.forEach((label, index) =>
        place(document.getElementById(label)!, left + 10 + index * 60, 50),
      );
    }
    return panel;
  }

  function dropTarget(
    element: Element,
    point: { x: number; y: number },
  ): ExperimentalItemDropTarget | null {
    let seen: ExperimentalItemDropTarget | null = null;
    const host = installHost([
      handler({
        pluginId: "studio",
        drop: (_item, target) => {
          seen = target;
        },
      }),
    ]);
    fire("drop", element, itemData(), null, point);
    host();
    return seen;
  }

  const indicator = () =>
    document.querySelector<HTMLElement>(`[${ITEM_DROP_INDICATOR_ATTRIBUTE}]`);

  it("names a pane's tab row and the insertion point, and draws a bar there", () => {
    const panel = mountPanes([["pane-primary", ["A", "B", "C"], 0]]);
    const strip = document.getElementById("B")!;
    dispose = installHost([handler({ pluginId: "studio" })]);
    fire("dragover", strip, itemData(), null, { x: 75, y: 10 });
    expect(indicator()?.getAttribute(ITEM_DROP_INDICATOR_ATTRIBUTE)).toBe(
      "bar",
    );
    expect(indicator()?.style.left).toBe("64px");
    expect(panel.hasAttribute(ITEM_DROP_ATTRIBUTE)).toBe(false);
    fire("dragend", strip, itemData());
    expect(indicator()).toBeNull();
    dispose();
    dispose = null;

    expect(dropTarget(strip, { x: 75, y: 10 })).toEqual({
      zone: "workbench",
      threadId: "thr_1",
      pane: 1,
      index: 1,
    });
    expect(dropTarget(strip, { x: 500, y: 10 })).toMatchObject({
      pane: 1,
      index: 3,
    });
  });

  it("names the right edge of a single pane as a new pane, and the rest of the panel as before", () => {
    const panel = mountPanes([["pane-primary", ["A"], 0]]);
    const body = document.getElementById("body-pane-primary")!;
    dispose = installHost([handler({ pluginId: "studio" })]);
    fire("dragover", body, itemData(), null, { x: 380, y: 300 });
    expect(indicator()?.getAttribute(ITEM_DROP_INDICATOR_ATTRIBUTE)).toBe(
      "edge",
    );
    expect(indicator()?.textContent).toBe("Split right");
    fire("dragover", body, itemData(), null, { x: 200, y: 300 });
    expect(indicator()).toBeNull();
    expect(panel.getAttribute(ITEM_DROP_ATTRIBUTE)).toBe("over");
    dispose();
    dispose = null;

    expect(dropTarget(body, { x: 380, y: 300 })).toEqual({
      zone: "workbench",
      threadId: "thr_1",
      pane: "new",
    });
    expect(dropTarget(body, { x: 200, y: 300 })).toEqual({
      zone: "workbench",
      threadId: "thr_1",
    });
  });

  it("numbers two panes left to right and offers no third", () => {
    mountPanes([
      ["pane-right", ["C"], 200],
      ["pane-primary", ["A", "B"], 0],
    ]);
    expect(
      dropTarget(document.getElementById("C")!, { x: 205, y: 10 }),
    ).toMatchObject({ pane: 2, index: 0 });
    expect(
      dropTarget(document.getElementById("A")!, { x: 205, y: 10 }),
    ).toMatchObject({ pane: 1, index: 2 });
    expect(
      dropTarget(document.getElementById("body-pane-right")!, {
        x: 390,
        y: 300,
      }),
    ).toEqual({ zone: "workbench", threadId: "thr_1" });
  });
});

describe("mention pills on a composer drop", () => {
  const itemData = () => transfer({ [ITEM_DRAG_TYPE]: JSON.stringify(thread) });

  it("binds insertMention and insertThreadMention to the composer's thread and the accepting plugin, and rejects bad values", () => {
    const app = mountApp();
    const insertMention = vi.fn(() => true);
    const insertThreadMention = vi.fn(() => true);
    const results: boolean[] = [];
    dispose = installHost(
      [
        handler({ pluginId: "alpha", canDrop: () => false }),
        handler({
          pluginId: "studio",
          drop: (_item, target) => {
            if (target.zone !== "composer") return;
            results.push(
              target.insertMention({
                provider: "docs",
                id: "doc_1",
                label: "Launch plan",
              }),
              target.insertThreadMention({ id: "thr_9", title: "Fix login" }),
              target.insertMention({ provider: "docs" } as never),
              target.insertThreadMention(null as never),
            );
          },
        }),
      ],
      { threadIdOf: () => "thr_1", insertMention, insertThreadMention },
    );
    fire("drop", app.composerInput, itemData());
    expect(results).toEqual([true, true, false, false]);
    expect(insertMention).toHaveBeenCalledTimes(1);
    expect(insertMention).toHaveBeenCalledWith("thr_1", "studio", {
      provider: "docs",
      id: "doc_1",
      label: "Launch plan",
    });
    expect(insertThreadMention).toHaveBeenCalledTimes(1);
    expect(insertThreadMention).toHaveBeenCalledWith("thr_1", "studio", {
      id: "thr_9",
      title: "Fix login",
    });
  });

  function publishComposer(
    threadId: string,
    insertAtCursor: ComposerEditorBridge["insertAtCursor"],
  ) {
    let draft = {
      text: "See ",
      mentions: [],
      attachments: [],
    } as unknown as PromptDraftState;
    const bridge = {
      host: {
        scope: { kind: "thread", threadId },
        textEffectKey: `thread/${threadId}`,
        getCurrent: () => draft,
        subscribeDraft: () => () => {},
        setDraft: (next: PromptDraftState) => {
          draft = next;
        },
        focus: () => {},
      },
      pluginCustomizable: true,
      state: { isAttaching: false, attachmentError: null },
      insertAtCursor,
      openPopup: () => false,
      closePopup: () => false,
      isPopupOpen: () => false,
      submit: () => Promise.resolve(),
    } as unknown as ComposerEditorBridge;
    publishComposerEditorBridge(bridge.host.textEffectKey, bridge);
    return {
      draft: () => draft,
      dispose: () =>
        clearComposerEditorBridge(bridge.host.textEffectKey, bridge),
    };
  }

  it("inserts the plugin's pill and bb's thread pill at the caret of that thread's composer", () => {
    const inserted: unknown[] = [];
    const composer = publishComposer("thr_1", (value) => {
      inserted.push(value);
      return true;
    });
    try {
      expect(
        insertComposerMention("thr_1", "studio", {
          provider: "docs",
          id: "doc_1",
          label: "Launch plan",
        }),
      ).toBe(true);
      expect(
        insertComposerThreadMention("thr_1", "studio", {
          id: "thr_9",
          title: "  ",
          projectId: "prj_1",
        }),
      ).toBe(true);
      expect(inserted).toMatchObject([
        {
          mentions: [
            {
              kind: "plugin",
              pluginId: "studio",
              provider: "docs",
              id: "doc_1",
              label: "Launch plan",
            },
          ],
        },
        {
          mentions: [
            {
              kind: "thread",
              threadId: "thr_9",
              projectId: "prj_1",
              label: "thr_9",
            },
          ],
        },
      ]);
      expect(
        insertComposerMention("thr_2", "studio", {
          provider: "docs",
          id: "doc_1",
          label: "x",
        }),
      ).toBe(false);
      expect(
        insertComposerMention("thr_1", "studio", {
          provider: "",
          id: "doc_1",
          label: "x",
        }),
      ).toBe(false);
      expect(
        insertComposerThreadMention("thr_1", "studio", { id: "", title: "x" }),
      ).toBe(false);
    } finally {
      composer.dispose();
    }
  });

  it("appends the pill to the draft when the composer has no caret", () => {
    const composer = publishComposer("thr_1", () => false);
    try {
      expect(
        insertComposerThreadMention("thr_1", "studio", {
          id: "thr_9",
          title: "Fix login",
        }),
      ).toBe(true);
      const draft = composer.draft();
      expect(draft.text.startsWith("See ")).toBe(true);
      expect(draft.text.length).toBeGreaterThan("See ".length);
      expect(draft.mentions).toHaveLength(1);
    } finally {
      composer.dispose();
    }
  });
});

describe("beginPointerItemDrag", () => {
  const view = window as unknown as Record<string, unknown>;
  let under: Element[] = [];

  beforeEach(() => {
    view.DataTransfer = FakeDataTransfer;
    view.DragEvent = FakeDragEvent;
    document.elementsFromPoint = () => under;
  });

  afterEach(() => {
    delete view.DataTransfer;
    delete view.DragEvent;
    Reflect.deleteProperty(document, "elementsFromPoint");
  });

  const tabItem: ExperimentalDragItem = {
    kind: "tab",
    id: "tab_1",
    title: "Launch plan",
    pluginId: "studio",
    tab: {
      pluginId: "studio",
      tabId: "page",
      params: { page: "p1" },
      threadId: "thr_1",
    },
  };

  it("turns a tab drag into item drag events on the element under the pointer", () => {
    const app = mountApp();
    const drop = vi.fn();
    dispose = installHost([handler({ pluginId: "studio", drop })]);
    const overlay = document.body.appendChild(document.createElement("div"));
    const drag = beginPointerItemDrag(document, tabItem, app.strip);
    expect(getCurrentDragItem()).toEqual(tabItem);

    under = [overlay, app.composerInput, app.composer];
    drag.move(10, 10);
    expect(app.composer.getAttribute(ITEM_DROP_ATTRIBUTE)).toBe("over");

    under = [overlay, app.timeline];
    expect(drag.end(20, 20)).toBe(true);
    expect(drop).toHaveBeenCalledWith(tabItem, { zone: "main" });
    expect(document.querySelector(`[${ITEM_DROP_ATTRIBUTE}]`)).toBeNull();
    expect(getCurrentDragItem()).toBeNull();
  });

  it("sends nothing while the pointer is over the tab strip it came from", () => {
    const app = mountApp();
    const canDrop = vi.fn(() => true);
    const drop = vi.fn();
    dispose = installHost([handler({ pluginId: "studio", canDrop, drop })]);
    const drag = beginPointerItemDrag(document, tabItem, app.strip);
    under = [app.strip, app.panel];
    drag.move(5, 5);
    expect(drag.end(6, 6)).toBe(false);
    expect(canDrop).not.toHaveBeenCalled();
    expect(drop).not.toHaveBeenCalled();
  });

  it("reaches a plugin's own target with the payload", () => {
    const app = mountApp();
    dispose = installHost([]);
    const received: (ExperimentalDragItem | null)[] = [];
    app.sidebar.addEventListener("dragover", (event) => event.preventDefault());
    app.sidebar.addEventListener("drop", (event) => {
      received.push(readDragItem(event.dataTransfer!));
    });
    const drag = beginPointerItemDrag(document, tabItem, app.strip);
    under = [app.sidebar];
    expect(drag.end(1, 1)).toBe(true);
    expect(received).toEqual([tabItem]);
  });

  it("clears the mark when the drag is cancelled", () => {
    const app = mountApp();
    dispose = installHost([handler({ pluginId: "studio" })]);
    const drag = beginPointerItemDrag(document, tabItem, app.strip);
    under = [app.timeline];
    drag.move(1, 1);
    expect(app.shell.hasAttribute(ITEM_DROP_ATTRIBUTE)).toBe(true);
    drag.cancel();
    expect(app.shell.hasAttribute(ITEM_DROP_ATTRIBUTE)).toBe(false);
    expect(getCurrentDragItem()).toBeNull();
  });
});
