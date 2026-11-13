import { createConnection } from "node:net";
import { describe, expect, it } from "vitest";
import {
  readAgentRequest,
  startAgentSocket,
  tokensMatch,
} from "../src/fork-desktop-agent-socket.js";
import { FORK_DESKTOP_CONTROL_ENV } from "../src/fork-desktop-control-ipc.js";
import {
  desktopControlDir,
  desktopDriverEnv,
  DRIVER_FIXED_ENV,
  driverMcpArgs,
  driverServeArgs,
  readCallResult,
} from "../src/fork-desktop-driver.js";
import {
  DesktopGrants,
  judgePointer,
  pausePhase,
} from "../src/fork-desktop-grants.js";
import { readHelperEvent } from "../src/fork-desktop-helper.js";
import {
  allPermissionsGranted,
  desktopSettingsUrl,
  readPermissions,
  screenRecordingNeedsRestart,
} from "../src/fork-desktop-permissions.js";
import {
  PinBoard,
  pinAgentText,
  pinChipLabel,
  roleName,
  shortUrl,
  targetFromInspect,
} from "../src/fork-desktop-pins.js";
import {
  defaultCaption,
  needsForeground,
  readSnapshot,
  sanitizeArgs,
  screenPoint,
  SECURE_REFUSAL,
  secureRefusal,
  SnapshotCache,
} from "../src/fork-desktop-policy.js";

describe("desktop permissions", () => {
  it("reads the helper's live answer and needs all three", () => {
    const partial = readPermissions(
      { accessibility: true, screenRecording: true, inputMonitoring: false },
      { accessibility: false, screenRecording: false },
    );
    expect(partial).toEqual({
      accessibility: true,
      screenRecording: true,
      inputMonitoring: false,
      checked: true,
    });
    expect(allPermissionsGranted(partial)).toBe(false);
    expect(allPermissionsGranted({ ...partial, inputMonitoring: true })).toBe(
      true,
    );
    expect(
      allPermissionsGranted({
        accessibility: true,
        screenRecording: true,
        inputMonitoring: true,
        checked: false,
      }),
    ).toBe(false);
  });

  it("falls back to Electron's checks without the helper, with Input Monitoring off", () => {
    expect(
      readPermissions(null, { accessibility: true, screenRecording: true }),
    ).toEqual({
      accessibility: true,
      screenRecording: true,
      inputMonitoring: false,
      checked: true,
    });
  });

  it("ignores values that are not true", () => {
    expect(
      readPermissions(
        { accessibility: "yes", screenRecording: 1, inputMonitoring: null },
        { accessibility: true, screenRecording: true },
      ).accessibility,
    ).toBe(false);
  });

  it("advises a relaunch only when Screen Recording arrived after launch", () => {
    const granted = {
      accessibility: true,
      screenRecording: true,
      inputMonitoring: true,
      checked: true,
    };
    expect(screenRecordingNeedsRestart(false, granted)).toBe(true);
    expect(screenRecordingNeedsRestart(true, granted)).toBe(false);
    expect(screenRecordingNeedsRestart(null, granted)).toBe(false);
    expect(
      screenRecordingNeedsRestart(false, {
        ...granted,
        screenRecording: false,
      }),
    ).toBe(false);
  });

  it("deep-links each permission's System Settings pane", () => {
    expect(desktopSettingsUrl("accessibility")).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
    expect(desktopSettingsUrl("screenRecording")).toContain(
      "Privacy_ScreenCapture",
    );
    expect(desktopSettingsUrl("inputMonitoring")).toContain(
      "Privacy_ListenEvent",
    );
  });
});

describe("the cursor grant", () => {
  const ask = {
    threadId: "thr_a",
    agent: "Bot",
    reason: "canvas",
    app: "Figma",
  };

  it("asks, and a session grant covers later actions until the mouse moves", async () => {
    const grants = new DesktopGrants();
    const pending = grants.askForeground(ask);
    const id = grants.snapshot().ask?.id ?? "";
    expect(grants.answer(id, "session")).toBe(true);
    await expect(pending).resolves.toBe("granted");
    expect(grants.allowsForeground("thr_a")).toBe(true);
    grants.usedForeground("thr_a");
    expect(grants.allowsForeground("thr_a")).toBe(true);
    expect(grants.allowsForeground("thr_b")).toBe(false);
    expect(grants.userMoved()).toBe(true);
    expect(grants.allowsForeground("thr_a")).toBe(false);
    expect(grants.userMoved()).toBe(false);
  });

  it("just once is used up by one foreground action", async () => {
    const grants = new DesktopGrants();
    const pending = grants.askForeground(ask);
    grants.answer(grants.snapshot().ask?.id ?? "", "once");
    await expect(pending).resolves.toBe("granted");
    expect(grants.snapshot().kind).toBe("once");
    grants.usedForeground("thr_a");
    expect(grants.snapshot().kind).toBe("none");
  });

  it("no refuses and grants nothing", async () => {
    const grants = new DesktopGrants();
    const pending = grants.askForeground(ask);
    grants.answer(grants.snapshot().ask?.id ?? "", "no");
    await expect(pending).resolves.toBe("refused");
    expect(grants.snapshot()).toEqual({
      kind: "none",
      threadId: null,
      ask: null,
    });
  });

  it("moving the mouse while a once grant is unused revokes it", async () => {
    const grants = new DesktopGrants();
    const pending = grants.askForeground(ask);
    grants.answer(grants.snapshot().ask?.id ?? "", "once");
    await pending;
    expect(grants.userMoved()).toBe(true);
    expect(grants.allowsForeground("thr_a")).toBe(false);
  });

  it("one ask at a time: the same thread joins it, another is busy", async () => {
    const grants = new DesktopGrants();
    const first = grants.askForeground(ask);
    const again = grants.askForeground(ask);
    await expect(
      grants.askForeground({ ...ask, threadId: "thr_b" }),
    ).resolves.toBe("busy");
    grants.answer(grants.snapshot().ask?.id ?? "", "session");
    await expect(first).resolves.toBe("granted");
    await expect(again).resolves.toBe("granted");
  });

  it("stop ends a pending ask and blocks the thread until resumed", async () => {
    const grants = new DesktopGrants();
    const pending = grants.askForeground(ask);
    grants.stop("thr_a");
    await expect(pending).resolves.toBe("stopped");
    await expect(grants.askForeground(ask)).resolves.toBe("stopped");
    expect(grants.isStopped("thr_a")).toBe(true);
    grants.resume("thr_a");
    expect(grants.isStopped("thr_a")).toBe(false);
  });

  it("a wrong ask id changes nothing, and an expired ask is a no", async () => {
    const grants = new DesktopGrants();
    const pending = grants.askForeground(ask);
    expect(grants.answer("ask-999", "session")).toBe(false);
    grants.expireAsk(grants.snapshot().ask?.id ?? "");
    await expect(pending).resolves.toBe("refused");
  });
});

describe("the user's input wins", () => {
  const target = { x: 100, y: 100, width: 400, height: 300 };

  it("sees movement, inside or outside the agent's window", () => {
    expect(judgePointer(null, { x: 0, y: 0, at: 1 }, target, 0)).toEqual({
      moved: false,
      insideTarget: false,
    });
    expect(
      judgePointer(
        { x: 200, y: 200, at: 1 },
        { x: 210, y: 200, at: 2 },
        target,
        0,
      ),
    ).toEqual({ moved: true, insideTarget: true });
    expect(
      judgePointer({ x: 10, y: 10, at: 1 }, { x: 30, y: 10, at: 2 }, target, 0),
    ).toEqual({ moved: true, insideTarget: false });
    expect(
      judgePointer(
        { x: 200, y: 200, at: 1 },
        { x: 201, y: 200, at: 2 },
        target,
        0,
      ).moved,
    ).toBe(false);
  });

  it("ignores the cursor while the agent drives it", () => {
    expect(
      judgePointer(
        { x: 200, y: 200, at: 1 },
        { x: 400, y: 200, at: 2 },
        target,
        10,
      ).moved,
    ).toBe(false);
  });

  it("pauses while the user moves in the window, and resumes after a quiet moment", () => {
    const moved = { moved: true, insideTarget: true };
    const still = { moved: false, insideTarget: false };
    const paused = pausePhase({
      phase: "acting",
      verdict: moved,
      now: 1000,
      pausedUntil: 0,
    });
    expect(paused).toEqual({ phase: "paused", pausedUntil: 2500 });
    expect(
      pausePhase({
        phase: "paused",
        verdict: still,
        now: 2000,
        pausedUntil: 2500,
      }).phase,
    ).toBe("paused");
    expect(
      pausePhase({
        phase: "paused",
        verdict: still,
        now: 2600,
        pausedUntil: 2500,
      }).phase,
    ).toBe("acting");
    expect(
      pausePhase({
        phase: "acting",
        verdict: { moved: true, insideTarget: false },
        now: 1,
        pausedUntil: 0,
      }).phase,
    ).toBe("acting");
    expect(
      pausePhase({ phase: "stopped", verdict: moved, now: 1, pausedUntil: 0 })
        .phase,
    ).toBe("stopped");
  });
});

describe("pins", () => {
  const inspect = {
    found: true,
    pid: 41,
    windowId: 7,
    app: "Safari",
    bundleId: "com.apple.Safari",
    title: "Pricing",
    url: "https://www.acme.dev/pricing?ref=1",
    bounds: { x: 70, y: 58, width: 820, height: 640 },
    element: {
      role: "AXButton",
      roleDescription: "button",
      label: "Start free trial",
      frame: { x: 400, y: 300, width: 160, height: 40 },
      secure: false,
    },
  };

  it("numbers pins in order and resets on clear", () => {
    const board = new PinBoard();
    const a = board.add({
      id: "a",
      threadId: "thr",
      x: 1,
      y: 2,
      at: 0,
      target: targetFromInspect(inspect),
      placed: true,
    });
    const b = board.add({
      id: "b",
      threadId: "thr",
      x: 3,
      y: 4,
      at: 0,
      target: targetFromInspect(null),
      placed: false,
    });
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(board.update("b", { placed: true })?.placed).toBe(true);
    board.take(["a"]);
    expect(board.get("a")?.taken).toBe(true);
    board.clear();
    expect(
      board.add({
        id: "c",
        threadId: null,
        x: 0,
        y: 0,
        at: 0,
        target: targetFromInspect(null),
        placed: true,
      }).number,
    ).toBe(1);
  });

  it("reads the app, element and page under the pointer", () => {
    const target = targetFromInspect(inspect);
    expect(target).toMatchObject({
      app: "Safari",
      pid: 41,
      windowId: 7,
      role: "button",
      label: "Start free trial",
      url: "https://www.acme.dev/pricing?ref=1",
      secure: false,
    });
    expect(target.elementFrame).toEqual({
      x: 400,
      y: 300,
      width: 160,
      height: 40,
    });
  });

  it("never keeps a password field's text", () => {
    const target = targetFromInspect({
      ...inspect,
      element: {
        role: "AXTextField",
        subrole: "AXSecureTextField",
        label: "hunter2",
        secure: true,
      },
    });
    expect(target.secure).toBe(true);
    expect(target.label).toBeNull();
  });

  it("labels the chip app · element · page", () => {
    const board = new PinBoard();
    const pin = board.add({
      id: "a",
      threadId: "thr",
      x: 480,
      y: 320,
      at: 0,
      target: targetFromInspect(inspect),
      placed: true,
    });
    expect(pinChipLabel(pin)).toBe(
      "Safari · “Start free trial” · acme.dev/pricing",
    );
    expect(pinAgentText(pin)).toContain("pid 41, window_id 7");
    expect(pinAgentText(pin)).toContain("In the window at: 410, 262");
    expect(
      pinChipLabel({
        app: null,
        label: null,
        role: null,
        url: null,
        windowTitle: null,
      }),
    ).toBe("Screen");
    expect(roleName("AXPopUpButton")).toBe("pop up button");
    expect(shortUrl("file:///home/x/notes.md")).toBe("notes.md");
  });
});

describe("what agents may do", () => {
  it("keeps only each tool's own arguments and defaults to the background", () => {
    const args = sanitizeArgs("click", {
      pid: 1,
      window_id: 2,
      element_token: "s1:3",
      scope: "desktop",
      session: "x",
      debug_image_out: "/tmp/a.png",
      delivery_mode: "weird",
    });
    expect(args).toEqual({
      pid: 1,
      window_id: 2,
      element_token: "s1:3",
      delivery_mode: "background",
    });
    expect(needsForeground(args)).toBe(false);
    expect(
      needsForeground(
        sanitizeArgs("type", { text: "hi", delivery_mode: "foreground" }),
      ),
    ).toBe(true);
    expect(
      sanitizeArgs("look", {
        pid: 1,
        window_id: 2,
        screenshot_out_file: "/etc/x",
      }),
    ).toEqual({ pid: 1, window_id: 2 });
    expect(
      sanitizeArgs("set_value", {
        element_token: "s1:1",
        value: "v",
        delivery_mode: "foreground",
      }),
    ).toEqual({ element_token: "s1:1", value: "v" });
  });

  const snapshot = readSnapshot(
    {
      snapshot_id: "s9",
      window_bounds: { x: 100, y: 50, width: 800, height: 600 },
      screenshot_scale: 2,
      elements: [
        {
          element_index: 1,
          role: "AXTextField",
          label: "Name",
          frame: { x: 120, y: 80, w: 200, h: 20 },
        },
        {
          element_index: 2,
          role: "AXTextField",
          subrole: "AXSecureTextField",
          label: "Password",
        },
        { element_index: 3, role: "AXSecureTextField" },
      ],
    },
    { pid: 5, windowId: 6 },
  );
  const cache = new SnapshotCache();
  if (snapshot !== null) cache.remember(snapshot);

  it("refuses password and secure fields by element", () => {
    const name = cache.forToken("s9:1");
    const password = cache.forToken("s9:2");
    const secure = cache.forToken("s9:3");
    expect(name?.element?.label).toBe("Name");
    expect(
      secureRefusal({
        tool: "type",
        element: name?.element ?? null,
        pointElement: null,
        focused: null,
        targetPid: 5,
        usesElementToken: true,
      }),
    ).toBeNull();
    expect(
      secureRefusal({
        tool: "type",
        element: password?.element ?? null,
        pointElement: null,
        focused: null,
        targetPid: 5,
        usesElementToken: true,
      }),
    ).toBe(SECURE_REFUSAL);
    expect(
      secureRefusal({
        tool: "click",
        element: secure?.element ?? null,
        pointElement: null,
        focused: null,
        targetPid: 5,
        usesElementToken: true,
      }),
    ).toBe(SECURE_REFUSAL);
  });

  it("refuses a secure field under a pixel point, and keys into a focused secure field", () => {
    expect(
      secureRefusal({
        tool: "click",
        element: null,
        pointElement: { secure: true },
        focused: null,
        targetPid: 5,
        usesElementToken: false,
      }),
    ).toBe(SECURE_REFUSAL);
    expect(
      secureRefusal({
        tool: "key",
        element: null,
        pointElement: null,
        focused: { pid: 5, element: { secure: true } },
        targetPid: 5,
        usesElementToken: false,
      }),
    ).toBe(SECURE_REFUSAL);
    expect(
      secureRefusal({
        tool: "type",
        element: null,
        pointElement: null,
        focused: { secureInput: true },
        targetPid: 5,
        usesElementToken: false,
      }),
    ).toBe(SECURE_REFUSAL);
    expect(
      secureRefusal({
        tool: "type",
        element: null,
        pointElement: null,
        focused: { pid: 9, element: { secure: true } },
        targetPid: 5,
        usesElementToken: false,
      }),
    ).toBeNull();
    expect(
      secureRefusal({
        tool: "scroll",
        element: null,
        pointElement: null,
        focused: { secureInput: true },
        targetPid: 5,
        usesElementToken: false,
      }),
    ).toBeNull();
  });

  it("places the ghost cursor on the element, or the pixel point in screen points", () => {
    expect(screenPoint({}, cache.forToken("s9:1"), null)).toEqual({
      x: 220,
      y: 90,
    });
    expect(
      screenPoint({ x: 200, y: 100 }, null, cache.forWindow(5, 6)),
    ).toEqual({ x: 200, y: 100 });
    expect(screenPoint({}, null, cache.forWindow(5, 6))).toEqual({
      x: 500,
      y: 350,
    });
    expect(screenPoint({}, null, null)).toBeNull();
    expect(
      defaultCaption("click", {}, cache.forToken("s9:1")?.element ?? null),
    ).toBe("clicking “Name”");
  });
});

describe("the bundled driver", () => {
  it("runs embedded with telemetry and update checks off on every launch", () => {
    const env = desktopDriverEnv(
      {
        PATH: "/usr/bin",
        HOME: "/home/someone",
        LANG: "en_US.UTF-8",
        LC_ALL: "C",
        CODEX_HOME: "/x",
        DO_NOT_TRACK: "0",
        CUA_DRIVER_RS_TELEMETRY_ENABLED: "1",
        OPENAI_API_KEY: "secret",
      },
      { stateDir: "/data/desktop-control", hostBundleId: "com.example.app" },
    );
    expect(env).toMatchObject({
      CUA_DRIVER_EMBEDDED: "1",
      DO_NOT_TRACK: "1",
      CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
      CUA_DRIVER_RS_UPDATE_CHECK: "0",
      CUA_TELEMETRY_ENABLED: "0",
      CUA_DRIVER_HOST_BUNDLE_ID: "com.example.app",
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
    });
    expect(env.HOME).toBe("/data/desktop-control/home");
    expect(env.CUA_DRIVER_RS_HOME).toBe(
      "/data/desktop-control/home/.cua-driver",
    );
    expect(env.CUA_DRIVER_TELEMETRY_HOME).toBe(
      "/data/desktop-control/home/.cua-driver",
    );
    expect(env).not.toHaveProperty("CODEX_HOME");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    for (const [name, value] of Object.entries(DRIVER_FIXED_ENV))
      expect(env[name]).toBe(value);
  });

  it("starts the daemon embedded without its own cursor, and never an update or skills command", () => {
    expect(driverServeArgs("/s/d.sock")).toEqual([
      "serve",
      "--embedded",
      "--no-overlay",
      "--socket",
      "/s/d.sock",
    ]);
    expect(driverMcpArgs("/s/d.sock")).toEqual([
      "mcp",
      "--embedded",
      "--socket",
      "/s/d.sock",
    ]);
    for (const args of [driverServeArgs("/s"), driverMcpArgs("/s")]) {
      expect(args.join(" ")).not.toMatch(/update|skills|install/u);
    }
  });

  it("finds the bundled driver only in a packaged app or an explicit dev folder", () => {
    expect(
      desktopControlDir({
        isPackaged: true,
        resourcesPath: "/A.app/Contents/Resources",
        env: {},
      }),
    ).toBe("/A.app/Contents/Resources/desktop-control");
    expect(
      desktopControlDir({ isPackaged: false, resourcesPath: "/r", env: {} }),
    ).toBeNull();
    expect(
      desktopControlDir({
        isPackaged: false,
        resourcesPath: "/r",
        env: { BB_STUDIO_DESKTOP_CONTROL_DIR: "/dev" },
      }),
    ).toBe("/dev");
  });

  it("reads tool results and helper events", () => {
    expect(
      readCallResult({
        content: [
          { type: "text", text: "a" },
          { type: "image", data: "b", mimeType: "image/png" },
        ],
        structuredContent: { x: 1 },
      }),
    ).toEqual({
      text: "a",
      images: [{ data: "b", mimeType: "image/png" }],
      structured: { x: 1 },
      isError: false,
    });
    expect(
      readCallResult({ isError: true, content: [{ type: "text", text: "no" }] })
        .isError,
    ).toBe(true);
    expect(readHelperEvent({ event: "key", key: "fn", down: true })).toEqual({
      event: "key",
      key: "fn",
      down: true,
    });
    expect(readHelperEvent({ event: "key", key: "fn" })).toBeNull();
  });
});

describe("the agent socket", () => {
  it("compares tokens in constant time and validates requests", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", 1)).toBe(false);
    expect(
      readAgentRequest({ threadId: "thr_1", tool: "click", args: { x: 1 } }),
    ).toEqual({
      threadId: "thr_1",
      tool: "click",
      agent: "Agent",
      args: { x: 1 },
      caption: null,
    });
    expect(readAgentRequest({ tool: "click" })).toBeNull();
  });

  it("answers only callers with the token it put in the environment", async () => {
    const env: NodeJS.ProcessEnv = {};
    const socket = startAgentSocket(env, (request) =>
      Promise.resolve({ ok: true, text: request.tool }),
    );
    const endpoint = JSON.parse(env[FORK_DESKTOP_CONTROL_ENV] ?? "{}") as {
      socket: string;
      token: string;
    };
    const ask = (token: string) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const client = createConnection(endpoint.socket);
        client.once("connect", () =>
          client.write(
            `${JSON.stringify({ id: 1, token, request: { threadId: "thr_1", tool: "status" } })}\n`,
          ),
        );
        client.setEncoding("utf8");
        client.once("data", (chunk: string) => {
          client.destroy();
          resolve(
            JSON.parse(chunk.split("\n")[0] ?? "{}") as Record<string, unknown>,
          );
        });
      });
    try {
      await new Promise(
        (resolve) =>
          socket.server.once("listening", resolve).listening && resolve(null),
      );
      await expect(ask(endpoint.token)).resolves.toMatchObject({
        ok: true,
        text: "status",
      });
      await expect(ask("wrong-token-wrong-token")).resolves.toMatchObject({
        ok: false,
        error: "not allowed",
      });
    } finally {
      socket.close();
    }
  });
});
