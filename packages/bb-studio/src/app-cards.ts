import { isMiniId } from "./minis/shared";

export function appCardLine(id: string, appCards: boolean): string {
  if (appCards) return `::app{id="${id}"}`;
  return isMiniId(id) ? `::mini{id="${id}"}` : `::artifact{id="${id}"}`;
}
