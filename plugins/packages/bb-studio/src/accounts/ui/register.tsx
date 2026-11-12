import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import type { ComponentType } from "react";
import { member, registerThreadBanner } from "../../kit/app/host-sdk";
import { registerHostWindow } from "../../kit/app/windows";
import { WARNINGS_WINDOW_ID } from "../shared";
import { AccountsFooter } from "./AccountsPanel";
import { ModelLoadNotice, ThreadSignedOutBanner } from "./notices";
import { hasAccountsFooter, openAccounts, setAccountsFooter, toggleAccounts } from "./store";
import { setLinkActionHandler } from "../../links/actions";
import { AccountsWatch, WarningsWindow } from "./Warnings";

export const ACCOUNTS_COMMAND_ID = "accounts";

interface ModelLoadNoticeRegistration {
  id: string;
  component: ComponentType<{ providerLabel: string; code: string; detail: string | null }>;
}

export function registerModelLoadNotice(slots: object, registration: ModelLoadNoticeRegistration): boolean {
  const slot = member(slots, "experimental_modelLoadNotice");
  if (typeof slot !== "function") return false;
  (slot as (registration: ModelLoadNoticeRegistration) => void).call(slots, registration);
  return true;
}

export function registerAccountsApp(app: PluginAppBuilder): void {
  setAccountsFooter(app.experimental_sidebarFooter.register({ kind: "disclosure", id: "accounts", label: "Accounts", icon: "UserRound", component: AccountsFooter }));
  setLinkActionHandler("accounts", () => { if (!hasAccountsFooter()) return false; openAccounts(); return true; });
  app.commands.register({ id: ACCOUNTS_COMMAND_ID, title: "Accounts", run: () => { toggleAccounts(); } });
  app.slots.experimental_appOverlay({ id: "accounts-watch", component: AccountsWatch });
  registerThreadBanner(app.slots, { id: "signed-out", component: ThreadSignedOutBanner });
  registerModelLoadNotice(app.slots, { id: "signed-out", component: ModelLoadNotice });
  registerHostWindow(app.slots, { id: WARNINGS_WINDOW_ID, title: "Accounts", component: WarningsWindow });
}
