import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";

export interface ComposerSource { threadId: string | null; projectId: string | null; path: string | null }
const sources = new WeakMap<HTMLElement, () => PluginComposerApi["scope"]>();
export const COMPOSE_PENDING_PREFIX = "compose:";

export function registerComposerSource(promptbox: HTMLElement, scope: () => PluginComposerApi["scope"]): () => void {
  sources.set(promptbox, scope);
  return () => { if (sources.get(promptbox) === scope) sources.delete(promptbox); };
}

export function composerSource(promptbox: HTMLElement | null, fallback: { threadId: string | null; projectId: string | null }): ComposerSource {
  const scope = promptbox && sources.get(promptbox)?.();
  if (scope?.kind === "thread") return { threadId: scope.threadId, projectId: fallback.projectId, path: null };
  if (scope?.kind === "new-thread") return { threadId: null, projectId: scope.projectId, path: location.pathname };
  return { ...fallback, path: fallback.threadId === null ? location.pathname : null };
}

export function composerPendingKey(source: ComposerSource): string | null {
  return source.threadId ?? (source.path?.startsWith("/plugins/") ? `${COMPOSE_PENDING_PREFIX}${source.path}` : null);
}

export function visibleComposers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-promptbox]")].filter(element =>
    element.offsetParent !== null && !element.closest('[hidden], [inert], [aria-hidden="true"]'),
  );
}
