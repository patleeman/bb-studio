// Trims the row under a thread's composer into its ⋯ menu: the "New thread
// in this environment" button, and the machine when it's the one BB runs on,
// so the row shows the machine only where the thread runs somewhere else.
// BB has no setting for that row; this hides its markup and stands in for it
// in the menu, and leaves the row as is if that markup changes.
import { COMPOSER_MORE_ITEM, ComposerMore, Icon } from "@bb-studio/kit/app";
import { STUDIO_PLUGIN_ID } from "@bb-studio/kit/contract";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";

const FOOTER = "[data-follow-up-composer-footer]";
const MOVED = "data-studio-composer-moved";
const CSS = `${FOOTER} [${MOVED}] { display: none !important; }`;
const ROW = "cursor-pointer items-center text-muted-foreground hover:bg-state-hover hover:text-foreground";

export function ComposerTrim() {
  const sdk = useSdk();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [local, setLocal] = useState<string[]>([]);
  const [machine, setMachine] = useState<string | null>(null);
  const [newThread, setNewThread] = useState<HTMLButtonElement | null>(null);
  useEffect(() => {
    // The host BB runs on is the one no machine provider made.
    sdk.hosts.list().then((hosts) => setLocal(hosts.filter((host) => host.machineProviderId === null).map((host) => host.name)), () => setLocal([]));
  }, [sdk]);

  useEffect(() => {
    if (document.querySelector(`style[${MOVED}]`)) return;
    const style = document.createElement("style");
    style.setAttribute(MOVED, "");
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    const shell = anchor?.closest("[data-promptbox]")?.parentElement;
    if (!shell) return;
    const mark = () => {
      const footer = shell.querySelector(FOOTER);
      const icon = footer?.querySelector('svg[data-icon="Laptop"]');
      const span = icon?.parentElement?.tagName === "SPAN" ? icon.parentElement : null;
      const name = span?.textContent?.trim() ?? "";
      const isLocal = !!span && local.includes(name);
      span?.toggleAttribute(MOVED, isLocal);
      setMachine(isLocal ? name : null);
      const button = footer?.querySelector<HTMLButtonElement>('button[aria-label="New thread in this environment"]') ?? null;
      button?.setAttribute(MOVED, "");
      setNewThread(button);
    };
    mark();
    // The footer re-renders and remounts with the thread.
    const observer = new MutationObserver(mark);
    observer.observe(shell, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const node of shell.querySelectorAll(`[${MOVED}]`)) node.removeAttribute(MOVED);
    };
  }, [anchor, local]);

  return (
    <>
      <span ref={setAnchor} hidden />
      <ComposerMore pluginId={STUDIO_PLUGIN_ID} order={0}>
        {machine ? (
          <div {...{ [COMPOSER_MORE_ITEM]: "" }} title={`Runs on ${machine}, this machine`}>
            <Icon name="Laptop" />
            <span className="min-w-0 truncate">{machine}</span>
          </div>
        ) : null}
        {newThread ? (
          <button type="button" className={ROW} onClick={() => newThread.click()}>
            <Icon name="MessageSquarePlus" />
            New thread in this environment
          </button>
        ) : null}
      </ComposerMore>
    </>
  );
}
