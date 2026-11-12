import { useSyncExternalStore } from "react";
import { openRelogin, type ReloginTarget } from "../../auth/ui/relogin-store";

interface FooterController { open(): void; close(): void; toggle(): void }

let footer: FooterController | null = null;
let signingIn: string | null = null;
const listeners = new Set<() => void>();

const notify = () => { for (const listener of listeners) listener(); };

export function setAccountsFooter(controller: FooterController | null): void {
  footer = controller;
}

export function hasAccountsFooter(): boolean {
  return footer !== null;
}

export function setSigningIn(key: string | null): void {
  if (signingIn === key) return;
  signingIn = key;
  notify();
}

export function openAccounts(signIn: { key: string; target: ReloginTarget } | null = null): void {
  if (!footer) {
    if (signIn) openRelogin(signIn.target);
    return;
  }
  if (signIn) setSigningIn(signIn.key);
  footer.open();
}

export function toggleAccounts(): void {
  if (footer) footer.toggle();
}

export function closeAccounts(): void {
  footer?.close();
}

export function useSigningIn(): string | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => signingIn, () => null);
}
