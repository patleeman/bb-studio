import { describe, expect, it } from "vitest";
import { zipFiles } from "./export-zip";
import { inflateRawSync } from "node:zlib";

describe("bulk ZIP", () => {
  it("writes an archive with one UTF-8 entry and a central directory", () => {
    const zip = zipFiles([{ name: "Résumé.md", bytes: Buffer.from("hello") }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.includes(Buffer.from("Résumé.md"))).toBe(true);
    const nameLength = zip.readUInt16LE(26);
    const compressedLength = zip.readUInt32LE(18);
    expect(inflateRawSync(zip.subarray(30 + nameLength, 30 + nameLength + compressedLength)).toString()).toBe("hello");
  });
});
