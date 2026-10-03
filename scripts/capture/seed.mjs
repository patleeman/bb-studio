import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { projectId, threadId, pluginRpc, bbCli, sleep } from "./bb.mjs";

export async function seedPages() {
  const markdown = [
    "> [!TIP] Scribe refreshes this page every weekday morning from the release threads.",
    "",
    "```stats",
    JSON.stringify([
      { label: "Beta teams", value: 42, delta: "+9", trend: "up", caption: "since last week" },
      { label: "Crash-free sessions", value: "99.4%", delta: "+0.6", trend: "up" },
      { label: "Open blockers", value: 3, delta: "-2", trend: "down" },
    ]),
    "```",
    "",
    "```chart",
    JSON.stringify({
      type: "bar",
      title: "Weekly active teams",
      x: "week",
      series: ["web", "desktop"],
      stacked: true,
      data: [
        { week: "Sep 1", web: 18, desktop: 7 },
        { week: "Sep 8", web: 22, desktop: 9 },
        { week: "Sep 15", web: 27, desktop: 12 },
        { week: "Sep 22", web: 29, desktop: 13 },
      ],
    }),
    "```",
    "",
    "## Launch checklist",
    "",
    "- [x] Ship offline sync to beta teams",
    "- [x] Publish the migration guide",
    "- [ ] Localise onboarding for Japanese and German",
    "- [ ] Final go/no-go review",
  ].join("\n");
  const { page } = await pluginRpc("pages", "create", { projectId, parentId: null, title: "Offline mode launch", icon: "🚀", markdown });
  const { page: child } = await pluginRpc("pages", "create", { projectId, parentId: page.id, title: "Rollout risks", icon: "⚠️", markdown: "- Storage quota on older devices" });
  const { page: notes } = await pluginRpc("pages", "create", { projectId, parentId: null, title: "Release notes: October", icon: "📝", markdown: "## Highlights\n\n- Offline sync for every team" });
  const cleanup = async () => {
    for (const id of [child.id, page.id, notes.id]) await pluginRpc("pages", "remove", { id }).catch(() => {});
  };
  return { page, notes, cleanup };
}

/** A "Checkout flow" diagram: three labelled steps joined by arrows. */
export async function seedDrawing() {
  let seed = 1;
  const base = (type, x, y, width, height, extra = {}) => ({
    id: `capture-${type}-${seed}`,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seed++,
    version: 1,
    versionNonce: seed * 7,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  });
  const steps = [
    ["Cart", "#a5d8ff"],
    ["Payment", "#ffec99"],
    ["Confirmation", "#b2f2bb"],
  ];
  const elements = [];
  steps.forEach(([label, fill], index) => {
    const x = index * 260;
    elements.push(base("rectangle", x, 0, 180, 90, { backgroundColor: fill, roundness: { type: 3 } }));
    elements.push(
      base("text", x + 20, 30, 140, 25, {
        text: label,
        originalText: label,
        fontSize: 20,
        fontFamily: 5,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: null,
        lineHeight: 1.25,
        autoResize: false,
      }),
    );
    if (index < steps.length - 1) {
      elements.push(base("arrow", x + 190, 45, 60, 0, { points: [[0, 0], [60, 0]], startArrowhead: null, endArrowhead: "arrow" }));
    }
  });
  elements.push(
    base("text", 0, 130, 420, 25, {
      text: "Retry payment on failure",
      originalText: "Retry payment on failure",
      fontSize: 16,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
      strokeColor: "#868e96",
    }),
  );
  const { drawing } = await pluginRpc("excalidraw", "createDrawing", { name: "Checkout flow", projectId });
  await pluginRpc("excalidraw", "saveDrawing", {
    id: drawing.id,
    data: JSON.stringify({ type: "excalidraw", version: 2, source: "bb-capture", elements, appState: { viewBackgroundColor: "#ffffff" }, files: {} }),
  });
  return { drawing, cleanup: () => pluginRpc("excalidraw", "deleteDrawing", { id: drawing.id }).catch(() => {}) };
}


/** A static HTML report; `draft` leaves out the September bar for version 1. */
export function usageReportHtml({ draft }) {
  const months = [
    ["July", 312],
    ["August", 368],
    ...(draft ? [] : [["September", 431]]),
  ];
  const bars = months
    .map(([month, teams]) => `<div class="row"><span>${month}</span><div class="bar" style="width:${Math.round((teams / 460) * 100)}%"></div><b>${teams}</b></div>`)
    .join("\n      ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Q3 usage report</title>
  <style>
    body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2328; background: #f6f8fa; }
    main { max-width: 760px; margin: 40px auto; padding: 32px 40px; background: #fff; border: 1px solid #d0d7de; border-radius: 12px; }
    h1 { margin: 0 0 4px; font-size: 26px; }
    .lede { margin: 0 0 24px; color: #59636e; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
    .stat { padding: 14px 16px; border: 1px solid #d0d7de; border-radius: 10px; }
    .stat b { display: block; font-size: 24px; }
    .stat span { color: #59636e; font-size: 13px; }
    .up { color: #1a7f37; font-size: 13px; }
    h2 { font-size: 16px; margin: 0 0 12px; }
    .row { display: grid; grid-template-columns: 90px 1fr 48px; align-items: center; gap: 12px; margin: 8px 0; }
    .bar { height: 18px; border-radius: 4px; background: linear-gradient(90deg, #6d5dfc, #3b82f6); }
    .row b { text-align: right; }
    ul { padding-left: 20px; color: #3d444d; }
  </style>
</head>
<body>
  <main>
    <h1>Q3 usage report</h1>
    <p class="lede">Acme app · weekly active teams, July to September</p>
    <section class="stats">
      <div class="stat"><b>${draft ? 368 : 431}</b><span>Active teams</span> <em class="up">${draft ? "+18%" : "+17%"}</em></div>
      <div class="stat"><b>99.4%</b><span>Crash-free sessions</span></div>
      <div class="stat"><b>6.2</b><span>Threads per member / week</span></div>
    </section>
    <h2>Active teams by month</h2>
    <div class="chart">
      ${bars}
    </div>
    <h2>Highlights</h2>
    <ul>
      <li>Offline sync reached every beta team in August.</li>
      <li>Team plans grew fastest in design and research orgs.</li>
    </ul>
  </main>
</body>
</html>
`;
}

/**
 * Saves "Q3 usage report" to Studio Artifacts twice from a thread's workspace,
 * so the viewer shows the second version of a real HTML artifact. The staged
 * BB's workspace thread has run once, so it has one.
 */
export async function seedArtifact() {
  const workspaceThreadId = process.env.BB_CAPTURE_WORKSPACE_THREAD_ID ?? threadId;
  const thread = JSON.parse(await bbCli(["thread", "get", workspaceThreadId, "--json"]));
  const workspace = thread.environment?.path;
  const hostId = thread.environment?.hostId;
  if (!workspace || !hostId) throw new Error("The capture thread needs a workspace to stage the report in.");
  const file = "q3-usage-report.html";
  const path = join(workspace, file);
  const write = (content) => bbCli(["file", "write", path, "--host", hostId, "--root", workspace, "--content", content]);
  let artifactId = null;
  const cleanup = async () => {
    if (artifactId) await pluginRpc("studio", "artifacts_delete", { id: artifactId }).catch(() => {});
    await bbCli(["file", "remove", path, "--yes", "--host", hostId, "--root", workspace]).catch(() => {});
  };
  try {
    for (const draft of [true, false]) {
      await write(usageReportHtml({ draft }));
      const { saved, failed } = await pluginRpc("studio", "artifacts_saveFiles", { threadId: workspaceThreadId, paths: [file] });
      if (failed.length) throw new Error(`Couldn't save the report: ${failed[0].error}`);
      artifactId = saved[0].artifactId;
    }
    await pluginRpc("studio", "artifacts_update", { id: artifactId, title: "Q3 usage report", description: "Weekly active teams, July to September" });
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { artifactId, cleanup };
}

export async function talkRpc(method, input) {
  const dir = await mkdtemp(join(tmpdir(), "bb-talk-capture-"));
  const file = join(dir, "input.json");
  await writeFile(file, JSON.stringify(input));
  try {
    return JSON.parse(await bbCli(["plugin", "rpc", "call", "talk", method, "--input-file", file, "--json"]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runText(command, args) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise((resolvePromise) => child.on("close", resolvePromise));
  if (code !== 0) throw new Error(`${command} failed: ${stderr}`);
  return stdout;
}

/**
 * Seeds a finished Talk recording from speech synthesized with macOS `say`,
 * uploaded and transcribed through the live plugin and BB's voice service.
 * `transcribe: false` uploads the audio and pauses the recording instead, for
 * captures that only need it listed where no voice service is configured.
 */
export async function seedTalkRecording(projectId, { transcribe = true, kind = "recording", title = "Weekly product sync" } = {}) {
  const pieces = [
    ["sync", "Welcome to the weekly product sync. First up, the offline mode beta shipped to forty teams on Monday, and crash reports are down by half since the storage fix."],
    ["sync", "Onboarding is the next focus. New users still stall at the import step, so design will prototype a guided import this sprint."],
    ["sync", "For hiring, Maria is running the loop for two senior engineers, with first interviews scheduled for Thursday."],
    ["after", "Action items. Priya drafts the guided import spec. Sam shares the crash dashboard. Everyone reviews the roadmap before Friday."],
  ];
  const dir = await mkdtemp(join(tmpdir(), "bb-talk-seed-"));
  const recording = await talkRpc("recording_create", { kind, projectId, threadId: null });
  try {
    await talkRpc("recording_rename", { id: recording.id, title });
    let startedAt = Date.now() - 20 * 60_000;
    const sessions = { sync: "captureseed1", after: "captureseed2" };
    const indexes = { sync: 0, after: 0 };
    for (const [n, [session, text]] of pieces.entries()) {
      const aiff = join(dir, `${n}.aiff`);
      const m4a = join(dir, `${n}.m4a`);
      await runText("say", ["-o", aiff, text]);
      await runText("afconvert", ["-f", "m4af", "-d", "aac", "-b", "32000", aiff, m4a]);
      const audio = await readFile(m4a);
      const info = await runText("afinfo", [m4a]);
      const durationMs = Math.round(Number(/estimated duration: ([\d.]+)/.exec(info)?.[1] ?? 0) * 1000);
      await talkRpc("segment_put", {
        recordingId: recording.id,
        sessionId: sessions[session],
        index: indexes[session]++,
        startedAt,
        durationMs,
        mimeType: "audio/mp4",
        audioBase64: audio.toString("base64"),
      });
      startedAt += durationMs + (session === "sync" ? 0 : 60_000);
    }
    if (!transcribe) {
      // Paused rather than left "Recording", so the card doesn't show a live badge.
      await talkRpc("recording_state", { id: recording.id, status: "paused" });
      return recording.id;
    }
    await talkRpc("recording_state", { id: recording.id, status: "finishing" });
    const started = Date.now();
    for (;;) {
      const current = JSON.parse(await bbCli(["talk", "show", recording.id, "--json"]));
      if (current.status === "done" && current.pendingCount === 0) {
        if (current.failedCount > 0) throw new Error(`Talk could not transcribe ${current.failedCount} seeded pieces.`);
        break;
      }
      if (Date.now() - started > 120_000) throw new Error("Timed out waiting for Talk to transcribe the seeded recording.");
      await sleep(1000);
    }
    return recording.id;
  } catch (error) {
    await talkRpc("recording_delete", { id: recording.id }).catch(() => {});
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
