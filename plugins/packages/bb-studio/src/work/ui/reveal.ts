import type { ToAppPath } from "../../kit/app/host-sdk";
import { WORK_ID } from "../shared";
import { messageLinkPath } from "./in-flight-model";

export const FLASH_CLASS = "studio-work-flash";
export const FLASH_MS = 1_800;
const WAIT_MS = 4_000;
const POLL_MS = 100;

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

export function cardElement(id: string, root: ParentNode = document): HTMLElement | null {
  return WORK_ID.test(id) ? root.querySelector<HTMLElement>(`[data-work-card-id="${id}"]`) : null;
}

export function flashCard(element: HTMLElement): void {
  clearTimeout(timers.get(element));
  element.classList.remove(FLASH_CLASS);
  void element.offsetWidth;
  element.classList.add(FLASH_CLASS);
  timers.set(element, setTimeout(() => { element.classList.remove(FLASH_CLASS); timers.delete(element); }, FLASH_MS));
}

function flashWhenShown(id: string, root: ParentNode, delayMs: number): void {
  const until = Date.now() + WAIT_MS;
  const look = () => {
    const element = cardElement(id, root);
    if (element) { flashCard(element); return; }
    if (Date.now() < until) setTimeout(look, POLL_MS);
  };
  setTimeout(look, delayMs);
}

export type Reveal = "link" | "scroll" | "none";

export function revealCard(input: {
  id: string;
  threadId: string;
  messageSeq: number | null;
  pathname: string;
  toAppPath: ToAppPath | null;
  root?: ParentNode;
}): Reveal {
  const root = input.root ?? document;
  const path = input.messageSeq === null ? null : messageLinkPath(input.pathname, input.threadId, input.messageSeq);
  if (path && input.toAppPath?.(path, { replace: true })) {
    flashWhenShown(input.id, root, 250);
    return "link";
  }
  const element = cardElement(input.id, root);
  if (!element) return "none";
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  flashCard(element);
  return "scroll";
}
