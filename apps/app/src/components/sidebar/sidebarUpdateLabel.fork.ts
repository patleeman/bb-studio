import type { SidebarUpdateModel } from "./sidebar-update-model";

export function forkSidebarUpdateLabel(model: SidebarUpdateModel): string | null {
  if (model.updating || model.bb !== null || model.rows.length === 0) return null;
  const [only] = model.rows;
  if (model.rows.length === 1 && only !== undefined) {
    return `${only.label} update available`;
  }
  if (model.rows.every((row) => row.kind === "provider")) {
    return `${model.rows.length} CLI updates available`;
  }
  if (model.rows.every((row) => row.kind === "plugin")) {
    return `${model.rows.length} plugin updates available`;
  }
  return null;
}
