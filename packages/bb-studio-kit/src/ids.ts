import { randomBytes } from "node:crypto";

/** New item ids use one 64-bit hex scheme. Existing ids remain valid in stores. */
export function newId(prefix: string): string {
  return `${prefix.replace(/_$/, "")}_${randomBytes(8).toString("hex")}`;
}

/** Accept legacy hex/base36 ids as well as the current scheme. */
export function isId(prefix: string, value: unknown): value is string {
  const stem = prefix.replace(/_$/, "");
  if (typeof value !== "string") return false;
  if (stem === "drw" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  const suffix = value.startsWith(`${stem}_`) ? value.slice(stem.length + 1) : "";
  return /^[a-z0-9]{16}$/.test(suffix) || (stem === "pg" && /^[a-f0-9]{12}$/.test(suffix));
}
