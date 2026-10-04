import { randomBytes } from "node:crypto";

/** New item ids use one 64-bit hex scheme. Existing ids remain valid in stores. */
export function newId(prefix: string): string {
  return `${prefix.replace(/_$/, "")}_${randomBytes(8).toString("hex")}`;
}
