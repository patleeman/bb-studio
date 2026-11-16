// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { BbDesktopApi } from "@bb/desktop-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import {
  folderNotes,
  folderRows,
  handleFileLinkContextMenu,
  resolveForkLocalPath,
  sortFolderEntries,
  type ForkFolderEntry,
  type ForkFolderListResult,
} from "@/lib/fork-finder";
import {
  ForkFolderFallback,
  ForkFolderListing,
  forkFinderLinkMenuItems,
} from "./ForkFinder";
import { SecondaryPanelFilePreview } from "./ThreadStorageFilePreview";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

function entry(
  name: string,
  kind: ForkFolderEntry["kind"],
  parent = "/work",
): ForkFolderEntry {
  return {
    name,
    path: `${parent}/${name}`,
    kind,
    sizeBytes: kind === "file" ? 2048 : null,
    modifiedAtMs: Date.UTC(2026, 10, 16, 9, 0),
  };
}

const FOLDERS: Record<string, ForkFolderListResult> = {
  "/work": {
    kind: "folder",
    path: "/work",
    parent: "/",
    totalCount: 6,
    hiddenCount: 0,
    entries: [
      entry("Tool.app", "package"),
      entry("b.txt", "file"),
      entry("shot10.png", "file"),
      entry("Clips", "directory"),
      entry("shot9.png", "file"),
      entry("assets", "directory"),
    ],
  },
  "/work/Clips": {
    kind: "folder",
    path: "/work/Clips",
    parent: "/work",
    totalCount: 1,
    hiddenCount: 2,
    entries: [entry("take1.mp4", "file", "/work/Clips")],
  },
  "/work/Locked": { kind: "unreadable", path: "/work/Locked", parent: "/work" },
  "/work/b.txt": { kind: "file", path: "/work/b.txt" },
};

const finder = {
  experimental_finderLabel: "Show in Finder",
  experimental_showInFinder: vi.fn(async () => "shown" as const),
  experimental_listFolder: vi.fn(
    async (path: string): Promise<ForkFolderListResult> =>
      FOLDERS[path] ?? { kind: "missing" },
  ),
  experimental_fileLinkMenu: vi.fn(async () => true),
};

beforeEach(() => {
  window.bbDesktop = { ...finder } as unknown as BbDesktopApi;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as { bbDesktop?: BbDesktopApi }).bbDesktop;
  document.body.innerHTML = "";
});

function rowNames(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("button")[0]?.textContent ?? "");
}

describe("folder listing order", () => {
  it("puts folders first, then sorts names naturally", () => {
    const listing = FOLDERS["/work"];
    if (listing?.kind !== "folder") throw new Error("fixture");
    expect(sortFolderEntries(listing.entries).map((item) => item.name)).toEqual(
      ["assets", "Clips", "Tool.app", "b.txt", "shot9.png", "shot10.png"],
    );
  });

  it("says how many items are shown and hidden", () => {
    const listing = FOLDERS["/work"];
    if (listing?.kind !== "folder") throw new Error("fixture");
    expect(folderNotes(listing)).toEqual([]);
    expect(
      folderNotes({ ...listing, totalCount: 4210, hiddenCount: 3 }),
    ).toEqual(["Showing 6 of 4,210", "3 hidden"]);
  });

  it("starts with a .. row unless the folder is the root", () => {
    const listing = FOLDERS["/work"];
    if (listing?.kind !== "folder") throw new Error("fixture");
    expect(folderRows(listing)[0]).toEqual({ kind: "parent", path: "/" });
    expect(
      folderRows({ ...listing, parent: null }).some(
        (row) => row.kind === "parent",
      ),
    ).toBe(false);
  });
});

describe("ForkFolderListing", () => {
  function renderListing() {
    const openFilePreview = vi.fn(() => true);
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <ForkFolderListing hostId="host_local" path="/work" />
      </AppNavigationHostProvider>,
    );
    return { openFilePreview };
  }

  it("shows the rows with .. first and folders before files", async () => {
    renderListing();
    await waitFor(() =>
      expect(rowNames()).toEqual([
        "..",
        "assets",
        "Clips",
        "Tool.app",
        "b.txt",
        "shot9.png",
        "shot10.png",
      ]),
    );
    expect(screen.getAllByText("2.0 KB").length).toBeGreaterThan(0);
  });

  it("goes into a subfolder and back up with ..", async () => {
    renderListing();
    fireEvent.click(await screen.findByRole("button", { name: "Clips" }));
    await waitFor(() => expect(rowNames()).toEqual(["..", "take1.mp4"]));
    expect(finder.experimental_listFolder).toHaveBeenLastCalledWith(
      "/work/Clips",
    );
    expect(
      screen.getByRole("button", { name: "Copy file path" }).textContent,
    ).toContain("/work/Clips");
    fireEvent.click(screen.getByRole("button", { name: ".." }));
    await waitFor(() => expect(rowNames()[1]).toBe("assets"));
    expect(finder.experimental_listFolder).toHaveBeenLastCalledWith("/work");
  });

  it("opens a file row in the file tab", async () => {
    const { openFilePreview } = renderListing();
    fireEvent.click(await screen.findByRole("button", { name: "b.txt" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      target: { kind: "host", hostId: "host_local", path: "/work/b.txt" },
      location: null,
    });
    expect(finder.experimental_listFolder).toHaveBeenCalledTimes(1);
  });

  it("shows a row or the open folder in Finder", async () => {
    renderListing();
    fireEvent.click(
      await screen.findByRole("button", { name: "Show in Finder: b.txt" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    expect(finder.experimental_showInFinder.mock.calls).toEqual([
      ["/work/b.txt"],
      ["/work"],
    ]);
  });
});

describe("ForkFolderListing states", () => {
  it("reveals a package row instead of walking into it", async () => {
    const openFilePreview = vi.fn(() => true);
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <ForkFolderListing hostId="host_local" path="/work" />
      </AppNavigationHostProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tool.app" }));
    expect(finder.experimental_showInFinder).toHaveBeenCalledWith(
      "/work/Tool.app",
    );
    expect(openFilePreview).not.toHaveBeenCalled();
    expect(finder.experimental_listFolder).toHaveBeenCalledTimes(1);
  });

  it("says an unreadable folder can't be read and keeps Show in Finder", async () => {
    render(<ForkFolderListing hostId="host_local" path="/work/Locked" />);
    expect(
      await screen.findByText("BB Studio can't read this folder"),
    ).toBeTruthy();
    expect(screen.queryByText("Folder not found")).toBeNull();
    const buttons = screen.getAllByRole("button", { name: "Show in Finder" });
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    expect(finder.experimental_showInFinder).toHaveBeenCalledWith(
      "/work/Locked",
    );
    fireEvent.click(screen.getByRole("button", { name: ".." }));
    expect(await screen.findByRole("button", { name: "assets" })).toBeTruthy();
  });

  it("shows the hidden count", async () => {
    render(<ForkFolderListing hostId="host_local" path="/work/Clips" />);
    expect(await screen.findByText("2 hidden")).toBeTruthy();
  });
});

describe("ForkFolderFallback", () => {
  it("shows a listing when a failed preview is a local folder", async () => {
    render(
      <ForkFolderFallback
        localPath={{ hostId: "host_local", path: "/work" }}
        failed
      >
        <p>Path is not a regular file</p>
      </ForkFolderFallback>,
    );
    expect(await screen.findByRole("button", { name: "assets" })).toBeTruthy();
    expect(screen.queryByText("Path is not a regular file")).toBeNull();
  });

  it("keeps the preview on screen while it probes, with no loading flash", () => {
    finder.experimental_listFolder.mockImplementationOnce(
      () => new Promise(() => {}),
    );
    render(
      <ForkFolderFallback
        localPath={{ hostId: "host_local", path: "/work" }}
        failed
      >
        <p>Read failed</p>
      </ForkFolderFallback>,
    );
    expect(screen.getByText("Read failed")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading folder" })).toBeNull();
  });

  it("marks a local preview so its links get the Finder menu", () => {
    const { container } = render(
      <ForkFolderFallback
        localPath={{ hostId: "host_local", path: "/work/a.md" }}
        failed={false}
      >
        <p>contents</p>
      </ForkFolderFallback>,
    );
    expect(container.querySelector("[data-fork-local-host]")).not.toBeNull();
  });

  it("keeps the error for a path that is not a folder", async () => {
    render(
      <ForkFolderFallback
        localPath={{ hostId: "host_local", path: "/work/b.txt" }}
        failed
      >
        <p>Read failed</p>
      </ForkFolderFallback>,
    );
    expect(await screen.findByText("Read failed")).toBeTruthy();
  });

  it("does not probe a preview that loaded", () => {
    render(
      <ForkFolderFallback
        localPath={{ hostId: "host_local", path: "/work" }}
        failed={false}
      >
        <p>contents</p>
      </ForkFolderFallback>,
    );
    expect(screen.getByText("contents")).toBeTruthy();
    expect(finder.experimental_listFolder).not.toHaveBeenCalled();
  });
});

describe("Show in Finder in the file tab header", () => {
  it("appears for a local path and reveals it", () => {
    render(
      <SecondaryPanelFilePreview
        activePath="/work/shot9.png"
        filePreview={
          {
            kind: "image",
            name: "shot9.png",
            path: "/work/shot9.png",
            url: "/raw/shot9.png",
            mimeType: "image/png",
            sizeBytes: 10,
          } as never
        }
        isLoading={false}
        onRefresh={() => {}}
        localPath={{ hostId: "host_local", path: "/work/shot9.png" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    expect(finder.experimental_showInFinder).toHaveBeenCalledWith(
      "/work/shot9.png",
    );
  });

  it("is absent without a local path", () => {
    render(
      <SecondaryPanelFilePreview
        activePath="/work/shot9.png"
        filePreview={undefined}
        isLoading
        localPath={null}
      />,
    );
    expect(screen.queryByRole("button", { name: "Show in Finder" })).toBeNull();
  });

  it("resolves only local hosts in the desktop app", () => {
    expect(
      resolveForkLocalPath({
        hasFinder: true,
        isLocal: true,
        path: "out/a.txt",
        rootPath: "/work",
      }),
    ).toBe("/work/out/a.txt");
    expect(
      resolveForkLocalPath({
        hasFinder: true,
        isLocal: false,
        path: "/work/a.txt",
        rootPath: null,
      }),
    ).toBeNull();
    expect(
      resolveForkLocalPath({
        hasFinder: false,
        isLocal: true,
        path: "/work/a.txt",
        rootPath: null,
      }),
    ).toBeNull();
    for (const path of ["/net/host/a", "//host/share/a", "/Network/x"]) {
      expect(
        resolveForkLocalPath({
          hasFinder: true,
          isLocal: true,
          path,
          rootPath: null,
        }),
      ).toBeNull();
    }
  });
});

describe("Show in Finder in the chat file link menu", () => {
  it("adds the item for a local thread and reveals the link's path", () => {
    const items = forkFinderLinkMenuItems("/work/notes.md", true);
    expect(
      items.map((item) => ("label" in item ? item.label : item.id)),
    ).toEqual(["Show in Finder"]);
    const [item] = items;
    if (
      item === undefined ||
      item.type === "separator" ||
      item.type === "submenu"
    ) {
      throw new Error("expected an action");
    }
    item.onSelect();
    expect(finder.experimental_showInFinder).toHaveBeenCalledWith(
      "/work/notes.md",
    );
  });

  it("adds nothing for a remote thread or outside the desktop app", () => {
    expect(forkFinderLinkMenuItems("/work/notes.md", false)).toEqual([]);
    delete (window as { bbDesktop?: BbDesktopApi }).bbDesktop;
    expect(forkFinderLinkMenuItems("/work/notes.md", true)).toEqual([]);
  });
});

describe("file link context menu", () => {
  function linkIn(
    markdown: boolean,
    href: string,
    local = true,
  ): HTMLAnchorElement {
    const root = document.createElement("div");
    if (markdown) root.setAttribute("data-markdown-preview", "");
    if (local) root.setAttribute("data-fork-local-host", "");
    const anchor = document.createElement("a");
    anchor.setAttribute("href", href);
    anchor.textContent = "link";
    root.appendChild(anchor);
    document.body.appendChild(root);
    return anchor;
  }

  function rightClick(target: Element): MouseEvent {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 48,
    });
    Object.defineProperty(event, "target", { value: target });
    return event;
  }

  it("opens the Finder menu for a file:// link to a local folder", () => {
    const anchor = linkIn(
      true,
      "file:///Users/someone/thread-storage/thr_1/fw-video",
    );
    const event = rightClick(anchor);
    expect(handleFileLinkContextMenu(event, finder, "http://127.0.0.1:1")).toBe(
      true,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(finder.experimental_fileLinkMenu).toHaveBeenCalledWith({
      path: "/Users/someone/thread-storage/thr_1/fw-video",
      href: "file:///Users/someone/thread-storage/thr_1/fw-video",
      selectionText: "",
      point: { x: 120, y: 48 },
    });
  });

  it("strips a line suffix from an absolute path link", () => {
    const anchor = linkIn(true, "/work/src/app.ts:12");
    handleFileLinkContextMenu(rightClick(anchor), finder, "http://127.0.0.1:1");
    expect(finder.experimental_fileLinkMenu).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/work/src/app.ts" }),
    );
  });

  it.each([
    ["a web link", true, "https://example.com/a.txt"],
    ["an app route", true, "/threads/thr_1"],
    ["a mention", true, "@thread:thr_1"],
    ["a link outside Markdown", false, "file:///work/a.txt"],
    ["a network path", true, "file:///net/host/a.txt"],
  ])("leaves the default menu for %s", (_label, markdown, href) => {
    const event = rightClick(linkIn(markdown, href));
    expect(handleFileLinkContextMenu(event, finder, "http://127.0.0.1:1")).toBe(
      false,
    );
    expect(event.defaultPrevented).toBe(false);
    expect(finder.experimental_fileLinkMenu).not.toHaveBeenCalled();
  });

  it("leaves Markdown whose host is not known to be this Mac alone", () => {
    const event = rightClick(linkIn(true, "file:///work/a.txt", false));
    expect(handleFileLinkContextMenu(event, finder, "http://127.0.0.1:1")).toBe(
      false,
    );
    expect(event.defaultPrevented).toBe(false);
    expect(finder.experimental_fileLinkMenu).not.toHaveBeenCalled();
  });

  it("does nothing outside the desktop app", () => {
    const event = rightClick(linkIn(true, "file:///work/a.txt"));
    expect(handleFileLinkContextMenu(event, null, "http://127.0.0.1:1")).toBe(
      false,
    );
    expect(event.defaultPrevented).toBe(false);
  });
});
