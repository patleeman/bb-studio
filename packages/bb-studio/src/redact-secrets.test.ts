import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact-secrets";

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, "../../bb-studio-mobile");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const body = (source: string) => source.slice(source.indexOf("export const REDACTED_LABEL"));

/** The same hashes are pinned in Studio Mobile's redact.test.ts and the desktop app's plugin-settings-redact.fork.test.ts. */
const REDACTOR_SHA256 = "19ba7f6307a0ad38a09baff0155e049dde31ae81e44a7571c100e3cd414b1f02";
const FIXTURES_SHA256 = "49c1f2786ca2cac35ffa06aa38d578956e128ee8383ec4d7a49ffe5337517a27";

describe("Studio's copy of the desktop app's redactor", () => {
  const fixturesText = readFileSync(join(mobile, "redact-fixtures.json"), "utf8");

  it("gives every shared fixture its output, and changes nothing on a second pass", () => {
    for (const { input, output } of JSON.parse(fixturesText) as { input: string; output: string }[]) {
      expect(redactSecrets(input)).toBe(output);
      expect(redactSecrets(output)).toBe(output);
    }
  });

  it("is byte for byte Studio Mobile's copy, pinned to the desktop app's", () => {
    const own = readFileSync(join(here, "redact-secrets.ts"), "utf8");
    expect(body(own)).toBe(body(readFileSync(join(mobile, "redact.ts"), "utf8")));
    expect(sha(body(own))).toBe(REDACTOR_SHA256);
    expect(sha(fixturesText)).toBe(FIXTURES_SHA256);
  });
});
