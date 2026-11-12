import { useSyncExternalStore } from "react";

export interface ReloginTarget {
  id: string;
  name: string;
  detail: string | null;
}

let current: ReloginTarget | null = null;
const listeners = new Set<() => void>();

function set(next: ReloginTarget | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export const openRelogin = (target: ReloginTarget) => set(target);
export const closeRelogin = () => set(null);

export function useReloginTarget(): ReloginTarget | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => current, () => null);
}
