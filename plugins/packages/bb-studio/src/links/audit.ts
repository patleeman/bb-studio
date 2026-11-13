import { pathFor, TAB_KIND_REGISTRY, type TabKindId, type TabRef } from "../tab-kinds";
import { directiveFor, linkFor, type LinkSource } from "./router";

export const SAMPLE_REFS: Record<TabKindId, TabRef> = {
  conversation: { kind: "conversation", id: "thr_1" },
  worker: { kind: "worker", id: "thr_2" },
  bot: { kind: "bot", id: "bot_main" },
  page: { kind: "page", id: "pg_0123456789abcdef" },
  whiteboard: { kind: "whiteboard", id: "drw_0123456789abcdef" },
  design: { kind: "design", id: "dsn_0123456789abcdef" },
  app: { kind: "app", id: "mini_0123456789abcdef" },
  artifact: { kind: "artifact", id: "art_0123456789abcdef" },
  recording: { kind: "recording", id: "rec_0123456789" },
  board: { kind: "board", id: "thr_board" },
  memory: { kind: "memory", id: "bot_main" },
  skills: { kind: "skills", id: "bot_main" },
  library: { kind: "library", id: null },
  automations: { kind: "automations", id: null },
  todos: { kind: "todos", id: "bot_main" },
  archive: { kind: "archive", id: "bot_main" },
  automation: { kind: "automation", id: "bot_main:aut_0123456789abcdef" },
  todo: { kind: "todo", id: "loop_0123abcd" },
  record: { kind: "record", id: "mem_0123456789abcdef" },
  vscode: { kind: "vscode", id: null },
  file: { kind: "file", id: "/Users/p/src/a.ts" },
  diff: { kind: "diff", id: "src/a.ts" },
  browser: { kind: "browser", id: "https://example.com/docs?x=1" },
  terminal: { kind: "terminal", id: null },
  workflow: { kind: "workflow", id: "wfr_0123abcd" },
};

export function linkSchemeTable(): string {
  const code = (value: string | null) => (value ? `\`${value}\`` : "");
  return [
    "| Kind | bb:// link | App route | Card directive |",
    "| --- | --- | --- | --- |",
    ...TAB_KIND_REGISTRY.map((entry) => { const ref = SAMPLE_REFS[entry.id]; return `| ${entry.name}${entry.owner === "bb" ? " (bb)" : ""} | ${code(linkFor(ref))} | ${code(pathFor(ref))} | ${code(directiveFor(ref))} |`; }),
  ].join("\n");
}

export interface LinkAuditSource {
  id: LinkSource;
  name: string;
  path: string;
  test: string;
}

export const LINK_AUDIT_SOURCES: readonly LinkAuditSource[] = [
  { id: "transcript", name: "Transcript link", path: "src/ui/link-handler.ts (bb's experimental_linkHandler)", test: "src/ui/link-handler.test.ts; src/links/router.test.ts" },
  { id: "gesture", name: "Mod/Shift-click", path: "src/ui/ItemGestures.tsx linkGesture", test: "src/ui/ItemGestures.test.tsx" },
  { id: "card", name: "Chat card", path: "src/links/open.ts useOpenCard (PageCard, DesignCard, DrawingDirective, MiniCard, ArtifactCard, RecordingCard)", test: "src/ui/studio-open.wiring.test.tsx (reply cards)" },
  { id: "page", name: "Link in a page", path: "src/pages/ui/PagesPanel.tsx openLink, src/pages/ui/PageEditor.tsx", test: "src/ui/studio-open.wiring.test.tsx (page content)" },
  { id: "whiteboard", name: "Link on a whiteboard", path: "src/links/whiteboard.ts (Excalidraw onLinkOpen)", test: "src/links/whiteboard.test.ts" },
  { id: "design", name: "Link in a design", path: "none: screens are sandboxed frames", test: "none" },
  { id: "mini", name: "Mini app bb.open", path: "src/minis/ui/mini-frame.tsx openTarget", test: "src/ui/studio-open.wiring.test.tsx (mini apps' bb.open)" },
  { id: "palette", name: "Cmd+K", path: "src/launcher/ui/CommandPalette.tsx run", test: "src/launcher/ui/CommandPalette.test.tsx" },
  { id: "launcher", name: "Launcher", path: "src/launcher/ui/Launcher.tsx run", test: "src/launcher/ui/Launcher.test.tsx" },
  { id: "agent", name: "workbench_open", path: "src/workbench-agent/server.ts linkedInput", test: "src/workbench-agent/workbench-agent.test.ts" },
  { id: "window", name: "Popped-out window", path: "src/links/open.ts inMainWindow, LinksBridge in each window", test: "src/links/open.test.ts; src/links/router.test.ts (relay)" },
  { id: "botPage", name: "Bot page row", path: "src/ui/bot-page/open-row.ts useRowOpen (Automations, Todos, Library, Memory, Archive)", test: "src/ui/bot-page/open-row.test.tsx; each page's test" },
];

export type LinkAuditCell = "routes" | { na: string };

const NO_TERMINAL = "A terminal has no id; nothing links one.";
const NO_CARD = "No card names one.";
const BB_LINK_ONLY = "Only by a bb:// link or file:// URL; marked items and in-app links are Studio's and threads.";
const DESIGN_FRAMES = "A design's screens are sandboxed frames; a link in one opens as the frame's popup. The design's card and header go through the router.";
const NO_PALETTE_ROW = "Cmd+K lists no such rows; a typed bb:// link, app route or web address goes through the router.";
const NO_DIFF_LINK = "Replies don't link a diff; bb's change cards open it.";
const NO_PAGE_ROW = "No Bot page lists one.";
const BOT_PAGE_ROWS: readonly TabKindId[] = ["conversation", "worker", "page", "whiteboard", "design", "app", "artifact", "automation", "todo", "record"];
const NO_AGENT_TERMINAL = "A terminal opens by starting one; workbench_focus selects an open one.";

function cell(kind: TabKindId, source: LinkSource): LinkAuditCell {
  if (source === "design") return { na: DESIGN_FRAMES };
  if (kind === "terminal") return { na: source === "agent" ? NO_AGENT_TERMINAL : NO_TERMINAL };
  const bbKind = kind === "file" || kind === "diff" || kind === "browser" || kind === "workflow";
  switch (source) {
    case "card":
      return ["conversation", "page", "whiteboard", "design", "app", "artifact", "recording", "todos"].includes(kind) ? "routes" : { na: NO_CARD };
    case "gesture":
      return bbKind ? { na: BB_LINK_ONLY } : "routes";
    case "palette": case "launcher":
      return bbKind ? { na: NO_PALETTE_ROW } : "routes";
    case "botPage":
      return BOT_PAGE_ROWS.includes(kind) ? "routes" : { na: NO_PAGE_ROW };
    case "transcript":
      return kind === "diff" ? { na: NO_DIFF_LINK } : "routes";
    default:
      return "routes";
  }
}

export const LINK_AUDIT: ReadonlyMap<TabKindId, Record<LinkSource, LinkAuditCell>> = new Map(TAB_KIND_REGISTRY.map((entry) => [entry.id, Object.fromEntries(LINK_AUDIT_SOURCES.map((source) => [source.id, cell(entry.id, source.id)])) as Record<LinkSource, LinkAuditCell>]));

export function linkAuditTable(): string {
  const notes: string[] = [];
  const text = (value: LinkAuditCell) => {
    if (value === "routes") return "routes";
    let at = notes.indexOf(value.na);
    if (at < 0) { notes.push(value.na); at = notes.length - 1; }
    return `n/a [${at + 1}]`;
  };
  const rows = TAB_KIND_REGISTRY.map((entry) => `| ${entry.name}${entry.owner === "bb" ? " (bb)" : ""} | ${LINK_AUDIT_SOURCES.map((source) => text(LINK_AUDIT.get(entry.id)![source.id])).join(" | ")} |`);
  return [
    `| Kind | ${LINK_AUDIT_SOURCES.map((source) => source.name).join(" | ")} |`,
    `| --- | ${LINK_AUDIT_SOURCES.map(() => "---").join(" | ")} |`,
    ...rows,
    "",
    ...notes.map((note, index) => `[${index + 1}] ${note}`),
  ].join("\n");
}

export function linkAuditSources(): string {
  return ["| Source | Where it calls the router | Test |", "| --- | --- | --- |", ...LINK_AUDIT_SOURCES.map((source) => `| ${source.name} | ${source.path} | ${source.test} |`)].join("\n");
}
