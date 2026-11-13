import type { PluginAppBuilder, PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { ComponentType } from "react";
import { isMiniId } from "../minis/shared";

export const APP_DIRECTIVE = "app";
export const APP_CARD_DIRECTIVES = [APP_DIRECTIVE, "artifact", "mini"] as const;

type Card = ComponentType<PluginMessageDirectiveProps>;

export function appCard(renderers: { saved: Card; interactive: Card }): Card {
  const { saved: Saved, interactive: Interactive } = renderers;
  function AppCard(props: PluginMessageDirectiveProps) {
    return isMiniId(props.attributes.id ?? "") ? <Interactive {...props} /> : <Saved {...props} />;
  }
  return AppCard;
}

export function registerAppCards(app: Pick<PluginAppBuilder, "slots">, renderers: { saved: Card; interactive: Card }): void {
  const component = appCard(renderers);
  for (const id of APP_CARD_DIRECTIVES) app.slots.messageDirective({ id, component });
}
