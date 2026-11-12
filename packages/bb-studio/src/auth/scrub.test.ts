import { expect, it } from "vitest";
import { redact, safeMessage, safeSignInUrl, safeUserCode, signInGuide } from "./scrub";

const TOKEN = "sk-ant-oat01-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0123456789";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJlZmFrZQ";

it("keeps only the link and the device code from CLI output", () => {
  const output = [
    "\u001b[1mWelcome to Codex\u001b[0m",
    `debug: access_token=${TOKEN}`,
    `Authorization: Bearer ${JWT}`,
    "Open \u001b[94mhttps://auth.example.test/codex/device\u001b[0m and enter",
    "   ABCD-1234",
    `refresh_token: "${TOKEN}"`,
  ].join("\r\n");
  const guide = signInGuide(output);
  expect(guide).toEqual({ url: "https://auth.example.test/codex/device", code: "ABCD-1234", acceptsCode: false });
  expect(JSON.stringify(guide)).not.toContain("FAKE");
  expect(JSON.stringify(guide)).not.toContain("eyJ");
});

it("reads a terminal hyperlink and a paste prompt", () => {
  const output = "\u001b]8;;https://login.example.test/authorize?code_challenge=abc&state=xyz\u0007Sign in\u001b]8;;\u0007\nPaste code here if prompted > ";
  expect(signInGuide(output)).toEqual({ url: "https://login.example.test/authorize?code_challenge=abc&state=xyz", code: null, acceptsCode: true });
});

it("refuses links that are not https or that carry a credential", () => {
  expect(safeSignInUrl("http://auth.example.test/device")).toBeNull();
  expect(safeSignInUrl(`https://auth.example.test/cb?access_token=${TOKEN}`)).toBeNull();
  expect(safeSignInUrl(`https://auth.example.test/cb#id_token=${JWT}`)).toBeNull();
  expect(safeSignInUrl("https://user:pass@auth.example.test/")).toBeNull();
  expect(safeSignInUrl("javascript:alert(1)")).toBeNull();
  expect(signInGuide(`visit https://auth.example.test/cb?token=${TOKEN}`).url).toBeNull();
  expect(safeSignInUrl("https://auth.example.test/device.")).toBe("https://auth.example.test/device");
});

it("accepts only short device codes", () => {
  expect(safeUserCode("ABCD-1234")).toBe("ABCD-1234");
  expect(safeUserCode(TOKEN)).toBeNull();
  expect(safeUserCode("abcd-1234")).toBeNull();
});

it("redacts token-like strings from messages", () => {
  const text = redact(`failed: Bearer ${JWT} access_token=${TOKEN} key ${TOKEN} jwt ${JWT} "refresh_token":"${TOKEN}"`);
  expect(text).not.toContain("FAKE");
  expect(text).not.toContain("eyJ");
  expect(text).toContain("[redacted]");
  expect(safeMessage(`\u001b[31mCodex token exchange failed (HTTP 400). ${TOKEN}\u001b[0m\nmore`, "x")).toBe("Codex token exchange failed (HTTP 400). [redacted]");
  expect(safeMessage("", "Sign-in failed.")).toBe("Sign-in failed.");
  expect(safeMessage("Code expired, start again.", "x")).toBe("Code expired, start again.");
});
