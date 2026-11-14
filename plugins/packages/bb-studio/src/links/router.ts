import type { OpenSpec } from "../workbench-agent/shared";
import { isTabKindId, itemKindOfId, pathFor, refOfPath, STUDIO_PLUGIN, tabKindEntry, TAB_KIND_REGISTRY, type StudioTabOpen, type TabKindId, type TabRef } from "../tab-kinds";
import type { OpenPlace, PanePlace } from "../ui/tab-open";

export const LINK_SCHEME = "bb";
const PREFIX = `${LINK_SCHEME}://`;

export type LinkHow = "workbench" | "secondPane" | "window" | "main";
export const LINK_HOWS: readonly LinkHow[] = ["workbench", "secondPane", "window", "main"];

export interface LinkModifiers { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean }

export type LinkSource = "transcript" | "card" | "page" | "whiteboard" | "design" | "mini" | "file" | "artifact" | "palette" | "launcher" | "agent" | "window" | "gesture" | "botPage";

export const LINK_ACTIONS = ["accounts", "edit-space"] as const;
export type LinkAction = (typeof LINK_ACTIONS)[number];
const isLinkAction = (value: string): value is LinkAction => (LINK_ACTIONS as readonly string[]).includes(value);

export type LinkTarget =
  | { type: "entity"; ref: TabRef; link: string }
  | { type: "action"; action: LinkAction; link: string }
  | { type: "external"; url: string; link: string };

export function linkFor(ref: TabRef): string {
  return ref.id === null ? `${PREFIX}${ref.kind}` : `${PREFIX}${ref.kind}/${encodeURIComponent(ref.id)}`;
}

export function directiveFor(ref: TabRef): string | null {
  const name = DIRECTIVE_OF_KIND[ref.kind];
  return name && ref.id ? `::${name}{id="${ref.id}"}` : null;
}

const decode = (segment: string): string | null => { try { return decodeURIComponent(segment); } catch { return null; } };

export function refOf(kind: TabKindId, id: string | null): TabRef | null {
  const entry = tabKindEntry(kind);
  switch (entry.ref) {
    case "item": {
      const actual = id ? itemKindOfId(id) : null;
      return actual ? { kind: actual, id } : null;
    }
    case "thread": case "run": case "entry": return id ? { kind, id } : null;
    case "path": case "url": return id ? { kind, id } : null;
    case "none": return { kind, id: null };
    case "bot": return kind === "bot" && !id ? null : { kind, id };
  }
}

const DIRECTIVE_KINDS: Record<string, TabKindId> = {
  page: "page", drawing: "whiteboard", whiteboard: "whiteboard", design: "design", mini: "app", app: "app",
  artifact: "artifact", recording: "recording", loop: "todos", loops: "todos", "bot-thread": "conversation", board: "board",
};
const DIRECTIVE_OF_KIND: Partial<Record<TabKindId, string>> = {
  page: "page", whiteboard: "drawing", design: "design", app: "mini", artifact: "artifact", recording: "recording",
};

function directiveAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of text.matchAll(/([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g)) attributes[match[1]!] = match[2] ?? match[3] ?? match[4] ?? "";
  return attributes;
}

function parseDirective(text: string): TabRef | null | undefined {
  const match = /^::([a-z-]+)\{([^}]*)\}$/i.exec(text);
  if (!match) return undefined;
  const kind = DIRECTIVE_KINDS[match[1]!.toLowerCase()];
  if (!kind) return null;
  const attributes = directiveAttributes(match[2]!);
  const id = attributes.id || attributes.threadId || null;
  return refOf(kind, kind === "todos" ? null : id);
}

function mentionRef(text: string): TabRef | null | undefined {
  const match = /^@?(page|thread):([^\s/?#]+)$/.exec(text);
  if (!match) return undefined;
  return refOf(match[1] === "page" ? "page" : "conversation", decode(match[2]!));
}

function parseScheme(rest: string): TabRef | null {
  const clean = rest.split(/[?#]/)[0]!.replace(/^\/+/, "");
  const slash = clean.indexOf("/");
  const first = slash === -1 ? clean : clean.slice(0, slash);
  const tail = slash === -1 ? "" : clean.slice(slash + 1);
  if (isTabKindId(first)) {
    const id = tail ? decode(tail) : null;
    if (tail && id === null) return null;
    return refOf(first, id && id.length ? id : null);
  }
  return refOfPath(`/${clean}`);
}

export function parseLink(text: string | null | undefined, origin: string = typeof window === "undefined" ? "" : window.location.origin): LinkTarget | null {
  const link = text?.trim() ?? "";
  if (!link) return null;
  const entity = (ref: TabRef | null): LinkTarget | null => (ref ? { type: "entity", ref, link } : null);
  const directive = parseDirective(link);
  if (directive !== undefined) return entity(directive);
  const reference = mentionRef(link);
  if (reference !== undefined) return entity(reference);
  if (link.toLowerCase().startsWith(PREFIX)) {
    const action = link.slice(PREFIX.length).split(/[?#]/)[0]!.replace(/^\/+|\/+$/g, "").toLowerCase();
    if (isLinkAction(action)) return { type: "action", action, link };
    return entity(parseScheme(link.slice(PREFIX.length)));
  }
  if (link.startsWith("/") && !link.startsWith("//")) return entity(refOfPath(link));
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol === "file:") {
    const path = decode(url.pathname);
    const mention = path ? mentionRef(path.slice(path.lastIndexOf("/") + 1)) : undefined;
    return entity(mention !== undefined ? mention : refOf("file", path));
  }
  if (/^https?:$/.test(url.protocol)) {
    if (origin && url.origin === origin) return entity(refOfPath(`${url.pathname}${url.search}${url.hash}`));
    return { type: "external", url: url.href, link };
  }
  return /^(mailto|tel):$/.test(url.protocol) ? { type: "external", url: url.href, link } : null;
}

export function howFor(modifiers?: LinkModifiers | null): LinkHow {
  if (modifiers?.shift) return "window";
  if (modifiers?.meta || modifiers?.ctrl) return "secondPane";
  return "workbench";
}

export interface LinkResolution { found: boolean; title: string | null; spec: OpenSpec | null }

export const NOT_FOUND_TAB = "link-not-found";
export const NOT_FOUND_TITLE = "Not found";
export interface NotFoundParams { kind: TabKindId; id: string | null; link: string }

export function notFoundTab(ref: TabRef, link: string): StudioTabOpen {
  const params: NotFoundParams = { kind: ref.kind, id: ref.id, link };
  return { pluginId: STUDIO_PLUGIN, tabId: NOT_FOUND_TAB, params: { ...params }, title: NOT_FOUND_TITLE };
}

export interface LinkWorkbench {
  layout(): { panes?: readonly unknown[] };
  open(spec: OpenSpec, options: { focus: boolean; pane?: PanePlace }): Promise<string | null>;
  popOut?(key: string): Promise<boolean>;
}

export interface LinkDeps {
  inMain(): boolean;
  relay(link: string, how: LinkHow): Promise<void>;
  thread(): string | null;
  studioPage(): boolean;
  resolve(ref: TabRef, threadId: string | null): Promise<LinkResolution>;
  workbench(threadId: string): LinkWorkbench | null;
  pageWorkbench(): LinkWorkbench | null;
  openTab(ref: TabRef, title: string | null, place: OpenPlace): Promise<boolean>;
  openStudioTab(open: StudioTabOpen, place: OpenPlace): Promise<boolean>;
  openMain(path: string): void;
  popOut(path: string, title: string | null): Promise<boolean>;
  openUrl(url: string): boolean;
  action(action: LinkAction): boolean;
  toast(message: string): void;
}

export interface OpenLinkOptions {
  source: LinkSource;
  how?: LinkHow;
  modifiers?: LinkModifiers | null;
  threadId?: string | null;
  title?: string | null;
}

export type LinkOutcome =
  | { via: "relay"; how: LinkHow }
  | { via: "external"; opened: boolean }
  | { via: "action"; action: LinkAction; opened: boolean }
  | { via: "notFound"; opened: boolean }
  | { via: "workbench"; pane: PanePlace | null; opened: boolean }
  | { via: "window"; opened: boolean }
  | { via: "main" }
  | { via: "none"; reason: string };

const paneCount = (wb: LinkWorkbench | null): number | null => {
  const panes = wb?.layout().panes;
  return Array.isArray(panes) ? panes.length : null;
};

export function needsResolution(ref: TabRef): boolean {
  const entry = tabKindEntry(ref.kind);
  if (entry.ref === "none" || ref.kind === "browser") return false;
  return ref.id !== null;
}

async function openSpec(wb: LinkWorkbench | null, spec: OpenSpec, pane: PanePlace | undefined): Promise<string | null> {
  if (!wb) return null;
  const key = await wb.open(spec, { focus: true, ...(pane !== undefined ? { pane } : {}) });
  return key ?? (pane !== undefined ? wb.open(spec, { focus: true }) : null);
}

export async function openLink(target: LinkTarget, options: OpenLinkOptions, deps: LinkDeps): Promise<LinkOutcome> {
  const how = options.how ?? howFor(options.modifiers);
  if (!deps.inMain()) {
    await deps.relay(target.link, how);
    return { via: "relay", how };
  }
  if (target.type === "external") {
    const opened = deps.openUrl(target.url);
    if (!opened && typeof window !== "undefined") window.open(target.url, "_blank", "noopener");
    return { via: "external", opened };
  }
  if (target.type === "action") return { via: "action", action: target.action, opened: deps.action(target.action) };
  const { ref } = target;
  const entry = tabKindEntry(ref.kind);
  const threadId = options.threadId ?? deps.thread();
  const path = pathFor(ref);
  if ((ref.kind === "conversation" || ref.kind === "worker") && ref.id === threadId && path) {
    deps.openMain(path);
    return { via: "main" };
  }
  const resolution = needsResolution(ref) ? await deps.resolve(ref, threadId).catch((): LinkResolution => ({ found: true, title: null, spec: null })) : { found: true, title: null, spec: ref.kind === "browser" && ref.id ? { kind: "url" as const, url: ref.id } : null };
  const title = options.title?.trim() || resolution.title;
  const wb = threadId ? deps.workbench(threadId) : null;
  const place = (pane?: PanePlace): OpenPlace => ({ threadId, ...(pane !== undefined ? { pane } : {}) });
  if (!resolution.found) {
    const opened = !threadId && deps.studioPage() ? await deps.openStudioTab(notFoundTab(ref, target.link), place(how === "secondPane" ? secondPane(deps.pageWorkbench()) : undefined)) : false;
    if (!opened) deps.toast(`${NOT_FOUND_TITLE}: ${target.link}`);
    return { via: "notFound", opened };
  }
  if (how === "main" && path) {
    deps.openMain(path);
    return { via: "main" };
  }
  if (how === "window") {
    if (path && (await deps.popOut(path, title))) return { via: "window", opened: true };
    if (resolution.spec && wb?.popOut) {
      const key = await openSpec(wb, resolution.spec, undefined);
      if (key && (await wb.popOut(key))) return { via: "window", opened: true };
      if (key) return { via: "workbench", pane: null, opened: true };
    }
  }
  const pane = how === "secondPane" ? secondPane(wb ?? (threadId ? null : deps.pageWorkbench())) : undefined;
  if (!threadId && path && ((entry.ref === "thread" && options.source !== "botPage") || !deps.studioPage())) {
    deps.openMain(path);
    return { via: "main" };
  }
  if (entry.open.via === "bb") {
    if (!resolution.spec) return { via: "none", reason: `${entry.name} links need an id BB can open.` };
    const key = await openSpec(wb, resolution.spec, pane);
    if (key) return { via: "workbench", pane: pane ?? null, opened: true };
    if (resolution.spec.kind === "url") return { via: "external", opened: deps.openUrl(resolution.spec.url) };
    deps.toast(`Couldn't open ${title ?? entry.name.toLowerCase()} here.`);
    return { via: "workbench", pane: pane ?? null, opened: false };
  }
  const opened = await deps.openTab(ref, title, place(pane));
  if (opened) return { via: "workbench", pane: pane ?? null, opened: true };
  if (path) {
    deps.openMain(path);
    return { via: "main" };
  }
  return { via: "workbench", pane: pane ?? null, opened: false };
}

export function secondPane(wb: LinkWorkbench | null): PanePlace {
  return paneCount(wb) === 2 ? 2 : "new";
}

export const LINK_KINDS: readonly TabKindId[] = TAB_KIND_REGISTRY.map((entry) => entry.id);
