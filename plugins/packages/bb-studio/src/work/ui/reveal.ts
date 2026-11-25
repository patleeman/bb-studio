import { WORK_ID } from "../shared";
import { TODO_ID } from "../../tasks/contract";

export const FLASH_CLASS = "studio-work-flash";
export const FLASH_MS = 1_800;

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

export function cardElement(id: string, root: ParentNode = document): HTMLElement | null {
  return WORK_ID.test(id) || TODO_ID.test(id) ? root.querySelector<HTMLElement>(`[data-work-card-id="${id}"]`) : null;
}

export function flashCard(element: HTMLElement): void {
  clearTimeout(timers.get(element));
  element.classList.remove(FLASH_CLASS);
  void element.offsetWidth;
  element.classList.add(FLASH_CLASS);
  timers.set(element, setTimeout(() => { element.classList.remove(FLASH_CLASS); timers.delete(element); }, FLASH_MS));
}
