import type { Stats } from "node:fs";
import type { IpcMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  fileLinkMenuTemplate,
  isAppWindowSender,
  listFolder,
  menuPopupPoint,
  parseFileLinkMenuRequest,
  parseLocalPath,
  registerForkFinderIpc,
  showInFinder,
  type ForkFinderFs,
} from "../src/fork-finder.js";
import {
  FORK_FINDER_LINK_MENU_CHANNEL,
  FORK_FINDER_LIST_CHANNEL,
  FORK_FINDER_SHOW_CHANNEL,
} from "../src/fork-finder-ipc.js";

vi.mock("electron", () => ({
  app: { getAppPath: () => "/app", getPath: () => "/tmp" },
  BrowserWindow: { fromWebContents: () => null },
  clipboard: { writeText: vi.fn() },
  globalShortcut: { register: () => true, unregister: () => {} },
  Menu: { buildFromTemplate: () => ({ popup: vi.fn() }) },
  screen: {},
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn() },
}));

type FakeNode =
  | { kind: "file"; size?: number; mtimeMs?: number }
  | { kind: "directory"; mtimeMs?: number; unreadable?: boolean }
  | { kind: "link"; to: string; mtimeMs?: number };

function permissionError(): Error {
  return Object.assign(new Error("EACCES"), { code: "EACCES" });
}

function missingError(): Error {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

function fakeFs(tree: Record<string, FakeNode>): ForkFinderFs {
  const resolve = (target: string, depth = 0): string => {
    if (depth > 8) throw missingError();
    for (const [key, node] of Object.entries(tree)) {
      if (node.kind !== "link") continue;
      if (target === key || target.startsWith(`${key}/`)) {
        return resolve(node.to + target.slice(key.length), depth + 1);
      }
    }
    if (tree[target] === undefined) throw missingError();
    return target;
  };
  const stats = (node: FakeNode): Stats =>
    ({
      isDirectory: () => node.kind === "directory",
      isSymbolicLink: () => node.kind === "link",
      size: node.kind === "file" ? (node.size ?? 0) : 0,
      mtimeMs: node.mtimeMs ?? 0,
    }) as Stats;
  return {
    async realpath(target) {
      return resolve(target);
    },
    async stat(target) {
      const node = tree[resolve(target)];
      if (node === undefined) throw missingError();
      return stats(node);
    },
    async lstat(target) {
      const node = tree[target];
      if (node === undefined) throw missingError();
      return stats(node);
    },
    async readdir(target) {
      const node = tree[target];
      if (node?.kind === "directory" && node.unreadable === true) {
        throw permissionError();
      }
      const prefix = target.endsWith("/") ? target : `${target}/`;
      return Object.keys(tree)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .filter((rest) => rest.length > 0 && !rest.includes("/"))
        .map((name) => {
          const child = tree[prefix + name];
          return {
            name,
            isDirectory: () => child?.kind === "directory",
            isSymbolicLink: () => child?.kind === "link",
          };
        });
    },
  };
}

function fakeShell(openError = "") {
  return {
    showItemInFolder: vi.fn(),
    openPath: vi.fn(async () => openError),
  };
}

const tree = fakeFs({
  "/": { kind: "directory" },
  "/Applications": { kind: "directory" },
  "/Applications/Calculator.app": { kind: "directory" },
  "/Applications/Calculator.app/Contents": { kind: "directory" },
  "/Applications/Calculator.app/Contents/Info.plist": { kind: "file" },
  "/work": { kind: "directory" },
  "/work/out": { kind: "directory", mtimeMs: 20 },
  "/work/clip.mp4": { kind: "file", size: 1024, mtimeMs: 10 },
  "/work/.hidden": { kind: "file" },
  "/work/Calc": { kind: "link", to: "/Applications/Calculator.app" },
  "/work/Setup.pkg": { kind: "directory" },
  "/work/Disk.sparsebundle": { kind: "directory" },
  "/work/foo.d": { kind: "directory" },
  "/work/Plugin": { kind: "directory" },
  "/work/Plugin/Contents": { kind: "directory" },
  "/work/Plugin/Contents/Info.plist": { kind: "file" },
  "/work/outlink": { kind: "link", to: "/work/out" },
  "/work/broken": { kind: "link", to: "/nowhere", mtimeMs: 5 },
  "/locked": { kind: "directory", unreadable: true },
});

describe("parseLocalPath", () => {
  it("accepts an absolute path and normalizes it", () => {
    expect(parseLocalPath("/work/out/../clip.mp4")).toBe("/work/clip.mp4");
  });

  it.each([
    ["a relative path", "work/clip.mp4"],
    ["an empty string", ""],
    ["a NUL byte", "/work/clip\0.mp4"],
    ["a URL", "file:///work/clip.mp4"],
    ["a shell string", "open -a Terminal /work"],
    ["a number", 42],
    ["an object", { path: "/work" }],
    ["a very long path", `/${"a".repeat(5000)}`],
    ["an autofs network path", "/net/host/share/a.txt"],
    ["the autofs root", "/net"],
    ["a Network path", "/Network/Servers/x"],
    ["a double-slash path", "//host/share/a.txt"],
    ["a UNC path", "\\\\host\\share\\a.txt"],
  ])("rejects %s", (_label, value) => {
    expect(parseLocalPath(value)).toBeNull();
  });

  it("keeps a local folder whose name only starts with net", () => {
    expect(parseLocalPath("/network-notes/a.txt")).toBe("/network-notes/a.txt");
  });
});

describe("showInFinder", () => {
  async function show(target: string) {
    const shell = fakeShell();
    const result = await showInFinder(target, { fs: tree, shell });
    return { result, shell };
  }

  it("selects a file in its folder", async () => {
    const { result, shell } = await show("/work/clip.mp4");
    expect(result).toBe("shown");
    expect(shell.showItemInFolder).toHaveBeenCalledWith("/work/clip.mp4");
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("opens a plain folder", async () => {
    const { result, shell } = await show("/work/out");
    expect(result).toBe("opened");
    expect(shell.openPath).toHaveBeenCalledWith("/work/out");
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it("opens a symlinked folder at its real path", async () => {
    const { result, shell } = await show("/work/outlink");
    expect(result).toBe("opened");
    expect(shell.openPath).toHaveBeenCalledWith("/work/out");
  });

  it.each([
    ["an extensionless symlink to an app", "/work/Calc"],
    ["an app bundle", "/Applications/Calculator.app"],
    ["a .pkg folder", "/work/Setup.pkg"],
    ["a .sparsebundle folder", "/work/Disk.sparsebundle"],
    ["a bundle with no extension", "/work/Plugin"],
    ["a folder named foo.d", "/work/foo.d"],
  ])("reveals %s and never opens it", async (_label, target) => {
    const { result, shell } = await show(target);
    expect(result).toBe("shown");
    expect(shell.openPath).not.toHaveBeenCalled();
    expect(shell.showItemInFolder).toHaveBeenCalledWith(target);
  });

  it("does nothing for a missing, broken or invalid path", async () => {
    for (const [target, expected] of [
      ["/work/gone.txt", "missing"],
      ["/work/broken", "missing"],
      ["../etc", "invalid"],
      ["/net/host/a", "invalid"],
    ] as const) {
      const { result, shell } = await show(target);
      expect(result).toBe(expected);
      expect(shell.showItemInFolder).not.toHaveBeenCalled();
      expect(shell.openPath).not.toHaveBeenCalled();
    }
  });

  it("reports a folder that the shell could not open", async () => {
    const shell = fakeShell("failed");
    await expect(showInFinder("/work/out", { fs: tree, shell })).resolves.toBe(
      "missing",
    );
  });
});

describe("listFolder", () => {
  it("lists folders first, with kind, size and modified time", async () => {
    const result = await listFolder("/work", { fs: tree });
    if (result.kind !== "folder") throw new Error(result.kind);
    expect(result).toMatchObject({
      path: "/work",
      parent: "/",
      totalCount: 9,
      hiddenCount: 1,
    });
    expect(
      result.entries.map((entry) => [entry.name, entry.kind, entry.sizeBytes]),
    ).toEqual([
      ["Calc", "package", null],
      ["Disk.sparsebundle", "package", null],
      ["foo.d", "directory", null],
      ["out", "directory", null],
      ["outlink", "directory", null],
      ["Plugin", "package", null],
      ["Setup.pkg", "package", null],
      ["broken", "file", null],
      ["clip.mp4", "file", 1024],
    ]);
    expect(
      result.entries.find((entry) => entry.name === "broken"),
    ).toMatchObject({ modifiedAtMs: 5 });
  });

  it("has no parent at the root", async () => {
    const result = await listFolder("/", { fs: tree });
    expect(result).toMatchObject({ kind: "folder", parent: null });
  });

  it("sorts folders first before the cap and reports the full count", async () => {
    const big: Record<string, FakeNode> = { "/big": { kind: "directory" } };
    for (let index = 0; index < 5; index += 1) {
      big[`/big/a-file-${index}.txt`] = { kind: "file" };
    }
    big["/big/z-folder"] = { kind: "directory" };
    const result = await listFolder("/big", { fs: fakeFs(big), limit: 3 });
    if (result.kind !== "folder") throw new Error(result.kind);
    expect(result.entries.map((entry) => entry.name)).toEqual([
      "z-folder",
      "a-file-0.txt",
      "a-file-1.txt",
    ]);
    expect(result.totalCount).toBe(6);
  });

  it("tells a file and a package apart from a folder", async () => {
    await expect(listFolder("/work/clip.mp4", { fs: tree })).resolves.toEqual({
      kind: "file",
      path: "/work/clip.mp4",
    });
    await expect(listFolder("/work/Calc", { fs: tree })).resolves.toEqual({
      kind: "package",
      path: "/work/Calc",
    });
  });

  it("says a folder it may not read is unreadable, not missing", async () => {
    await expect(listFolder("/locked", { fs: tree })).resolves.toEqual({
      kind: "unreadable",
      path: "/locked",
      parent: "/",
    });
  });

  it("rejects relative, network and missing paths", async () => {
    await expect(listFolder("work", { fs: tree })).resolves.toEqual({
      kind: "invalid",
    });
    await expect(listFolder("/net/host", { fs: tree })).resolves.toEqual({
      kind: "invalid",
    });
    await expect(listFolder("/nope", { fs: tree })).resolves.toEqual({
      kind: "missing",
    });
  });

  it("refuses a symlink that resolves into the network", async () => {
    const linked = fakeFs({
      "/work": { kind: "directory" },
      "/work/share": { kind: "link", to: "/net/host" },
      "/net/host": { kind: "directory" },
    });
    await expect(listFolder("/work/share", { fs: linked })).resolves.toEqual({
      kind: "invalid",
    });
  });
});

describe("file link menu", () => {
  it("validates the request", () => {
    expect(
      parseFileLinkMenuRequest({
        path: "relative",
        href: "",
        selectionText: "",
      }),
    ).toBeNull();
    expect(parseFileLinkMenuRequest(null)).toBeNull();
    expect(
      parseFileLinkMenuRequest({
        path: "/work/clip.mp4",
        href: "file:///work/clip.mp4",
        selectionText: 7,
      }),
    ).toEqual({
      path: "/work/clip.mp4",
      href: "file:///work/clip.mp4",
      selectionText: "",
      point: null,
    });
    expect(
      parseFileLinkMenuRequest({
        path: "/work/clip.mp4",
        href: "",
        selectionText: "",
        point: { x: 40.5, y: 12 },
      })?.point,
    ).toEqual({ x: 40.5, y: 12 });
    for (const point of [
      { x: -1, y: 2 },
      { x: Infinity, y: 2 },
      { x: "1", y: 2 },
    ]) {
      expect(
        parseFileLinkMenuRequest({
          path: "/w",
          href: "",
          selectionText: "",
          point,
        })?.point,
      ).toBeNull();
    }
  });

  it("places the menu at the clicked link, scaled by the page zoom", () => {
    expect(menuPopupPoint({ x: 100.4, y: 50 }, 1.25)).toEqual({
      x: 126,
      y: 63,
    });
    expect(menuPopupPoint({ x: 10, y: 20 }, Number.NaN)).toEqual({
      x: 10,
      y: 20,
    });
    expect(menuPopupPoint(null, 2)).toBeNull();
  });

  it("offers Show in Finder, Copy Link and Copy Path for a file on this Mac", async () => {
    const shell = fakeShell();
    const writeText = vi.fn();
    const template = await fileLinkMenuTemplate(
      {
        path: "/work/clip.mp4",
        href: "file:///work/clip.mp4",
        selectionText: "",
        point: null,
      },
      { fs: tree, shell, platform: "darwin", writeText },
    );
    expect(template.map((item) => item.label ?? item.type)).toEqual([
      "Show in Finder",
      "separator",
      "Copy Link",
      "Copy Path",
    ]);
    expect(template[0]?.enabled).toBe(true);
    template[0]?.click?.(
      {} as Electron.MenuItem,
      undefined,
      {} as Electron.KeyboardEvent,
    );
    await vi.waitFor(() =>
      expect(shell.showItemInFolder).toHaveBeenCalledWith("/work/clip.mp4"),
    );
    template[3]?.click?.(
      {} as Electron.MenuItem,
      undefined,
      {} as Electron.KeyboardEvent,
    );
    expect(writeText).toHaveBeenCalledWith("/work/clip.mp4");
  });

  it("disables Show in Finder when the path is not on this Mac", async () => {
    const template = await fileLinkMenuTemplate(
      { path: "/elsewhere/a.txt", href: "", selectionText: "a", point: null },
      { fs: tree, platform: "darwin" },
    );
    expect(template[0]).toMatchObject({
      label: "Show in Finder",
      enabled: false,
    });
    expect(
      template.map((item) => item.label ?? item.role ?? item.type),
    ).toEqual([
      "Show in Finder",
      "separator",
      "Copy Path",
      "separator",
      "copy",
    ]);
  });
});

describe("caller check", () => {
  const mainFrame = { name: "main" };
  const appWindows = new Set([7]);

  it("accepts the main frame of an app window or a fork window", () => {
    expect(
      isAppWindowSender(
        { sender: { id: 7, mainFrame }, senderFrame: mainFrame },
        appWindows,
        () => false,
      ),
    ).toBe(true);
    expect(
      isAppWindowSender(
        { sender: { id: 9, mainFrame }, senderFrame: mainFrame },
        appWindows,
        (id) => id === 9,
      ),
    ).toBe(true);
  });

  it("refuses a subframe, an unknown window and a gone frame", () => {
    expect(
      isAppWindowSender(
        { sender: { id: 7, mainFrame }, senderFrame: { name: "child" } },
        appWindows,
        () => false,
      ),
    ).toBe(false);
    expect(
      isAppWindowSender(
        { sender: { id: 8, mainFrame }, senderFrame: mainFrame },
        appWindows,
        () => false,
      ),
    ).toBe(false);
    expect(
      isAppWindowSender(
        { sender: { id: 7, mainFrame }, senderFrame: null },
        appWindows,
        () => false,
      ),
    ).toBe(false);
  });

  it("gates all three channels", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerForkFinderIpc(
      {
        handle: (channel: string, listener: (...args: unknown[]) => unknown) =>
          handlers.set(channel, listener),
      } as unknown as IpcMain,
      appWindows,
      () => false,
    );
    expect([...handlers.keys()].sort()).toEqual(
      [
        FORK_FINDER_LINK_MENU_CHANNEL,
        FORK_FINDER_LIST_CHANNEL,
        FORK_FINDER_SHOW_CHANNEL,
      ].sort(),
    );
    const stranger = { sender: { id: 8, mainFrame }, senderFrame: mainFrame };
    expect(await handlers.get(FORK_FINDER_SHOW_CHANNEL)?.(stranger, "/")).toBe(
      "invalid",
    );
    expect(
      await handlers.get(FORK_FINDER_LIST_CHANNEL)?.(stranger, "/"),
    ).toEqual({ kind: "invalid" });
    expect(
      await handlers.get(FORK_FINDER_LINK_MENU_CHANNEL)?.(stranger, {
        path: "/",
        href: "",
        selectionText: "",
        point: null,
      }),
    ).toBe(false);
    const app = { sender: { id: 7, mainFrame }, senderFrame: mainFrame };
    expect(
      await handlers.get(FORK_FINDER_SHOW_CHANNEL)?.(app, "rm -rf /"),
    ).toBe("invalid");
    expect(
      await handlers.get(FORK_FINDER_LIST_CHANNEL)?.(app, { path: "/" }),
    ).toEqual({ kind: "invalid" });
  });
});
