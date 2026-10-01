// Trims the row under a thread's composer: no "New thread in this
// environment" button, and no machine when it's the one BB runs on, so the
// machine shows only where the thread runs somewhere else. BB has no setting
// for that row; this styles its markup, and leaves it as is if that changes.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";

const FOOTER = "[data-follow-up-composer-footer]";
const LOCAL = "data-studio-local-machine";
const CSS = `${FOOTER} button[aria-label="New thread in this environment"], ${FOOTER} [${LOCAL}] { display: none !important; }`;

export function ComposerTrim() {
  const sdk = useSdk();
  const [local, setLocal] = useState<string[]>([]);
  useEffect(() => {
    // The host BB runs on is the one no machine provider made.
    sdk.hosts.list().then((hosts) => setLocal(hosts.filter((host) => host.machineProviderId === null).map((host) => host.name)), () => setLocal([]));
  }, [sdk]);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    const mark = () => {
      for (const icon of document.querySelectorAll(`${FOOTER} svg[data-icon="Laptop"]`)) {
        const machine = icon.parentElement;
        if (!machine || machine.tagName !== "SPAN") continue;
        machine.toggleAttribute(LOCAL, local.includes(machine.textContent?.trim() ?? ""));
      }
    };
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; mark(); });
    });
    mark();
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const machine of document.querySelectorAll(`[${LOCAL}]`)) machine.removeAttribute(LOCAL);
    };
  }, [local]);
  return null;
}
