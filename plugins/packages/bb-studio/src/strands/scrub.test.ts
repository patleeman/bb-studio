import { describe, expect, it } from "vitest";
import { scrubber } from "./scrub";

const scrub = scrubber();

describe("scrubber: named secrets, headers and cookies", () => {
  it.each([
    ["ANTHROPIC_AUTH_TOKEN=abc123def456", "ANTHROPIC_AUTH_TOKEN=[redacted]"],
    ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIabc", "AWS_SECRET_ACCESS_KEY=[redacted]"],
    ["SLACK_BOT_TOKEN=xyz-not-a-real-one", "SLACK_BOT_TOKEN=[redacted]"],
    ["STRIPE_SECRET_KEY=rk_test_abc", "STRIPE_SECRET_KEY=[redacted]"],
    ["MY_PRIVATE_TOKEN_VALUE=plainvalue", "MY_PRIVATE_TOKEN_VALUE=[redacted]"],
    ["OPENAI_API_KEY=plainvalue", "OPENAI_API_KEY=[redacted]"],
    ["DB_PASSWORD=hunter2hunter2", "DB_PASSWORD=[redacted]"],
    ["GITHUB_CREDENTIALS: abc", "GITHUB_CREDENTIALS: [redacted]"],
    ['{"authToken": "abc", "sessionId": "s-1"}', '{"authToken": "[redacted]", "sessionId": "[redacted]"}'],
    ["awsAccessKey=plainvalue", "awsAccessKey=[redacted]"],
    ["config.auth.key = plainvalue", "config.auth.key = [redacted]"],
    ["cookie: session=abc; theme=dark", "cookie: [redacted]"],
    ["Set-Cookie: sid=abc; HttpOnly", "Set-Cookie: [redacted]"],
    ["Authorization: Basic dXNlcjpwYXNz", "Authorization: [redacted]"],
    ["Proxy-Authorization: Digest username=x", "Proxy-Authorization: [redacted]"],
    ["authorization: Bearer abcdefghijkl", "authorization: [redacted]"],
  ])("%s", (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it("leaves ordinary pairs alone", () => {
    for (const text of ["keyboard: logitech", "author: Jane", "monkey=3", "status: ok", "model=new-model", "turns: 25"]) expect(scrub(text)).toBe(text);
  });

  it("keeps the line structure: a header redaction stops at the end of its line", () => {
    expect(scrub("Authorization: Basic dXNl\nnext line stays")).toBe("Authorization: [redacted]\nnext line stays");
  });
});
