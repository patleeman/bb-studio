import { describe, expect, it } from "vitest";
import { scrubber } from "./scrub";

const scrub = scrubber();

describe("scrubber: secrets go", () => {
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
    ["curl --token=plainvalue https://x", "curl --token=[redacted] https://x"],
    ["gh auth login --with-token=abc", "gh auth login --with-token=[redacted]"],
    ["MY_KEY=s3cr3tvalue99", "MY_KEY=[redacted]"],
    ["cookie: session=abc; theme=dark", "cookie: [redacted]"],
    ["Set-Cookie: sid=abc; HttpOnly", "Set-Cookie: [redacted]"],
    ["curl -H 'Cookie: sid=abc123' x", "curl -H 'Cookie: [redacted]' x"],
    ["Authorization: Basic dXNlcjpwYXNz", "Authorization: [redacted]"],
    ["Proxy-Authorization: Digest username=x", "Proxy-Authorization: [redacted]"],
    ["curl -H 'Authorization: Token abcdef123456' x", "curl -H 'Authorization: [redacted]' x"],
  ])("%s", (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });
});

describe("scrubber: ordinary text stays", () => {
  it.each([
    "Session: 3 went well",
    "In this session: we fixed the bug",
    "**Session:** recap",
    "Tokens: 1234",
    "max_tokens: 4096",
    "historyTokens: 150000",
    "inputTokens=1200",
    "tokenizer=cl100k",
    "secretary: Bob",
    "sessions: 12",
    "passwordless=true",
    "<li key={item.id}>",
    'const key = "theme";',
    "key: Enter",
    "Primary key: id",
    "token: string; sessionId: string; auth: AuthConfig",
    "password: string",
    "cookie: the browser stores it",
    "The authorization: header is missing",
    "keyboard: logitech",
    "author: Jane",
    "monkey=3",
    "status: ok",
    "model=new-model",
    "turns: 25",
  ])("%s", (text) => {
    expect(scrub(text)).toBe(text);
  });

  it("keeps the line structure: a header redaction stops at the end of its line", () => {
    expect(scrub("Authorization: Basic dXNl12345\nnext line stays")).toBe("Authorization: [redacted]\nnext line stays");
  });
});

describe("scrubber: a secret after an ordinary pair in the same word goes", () => {
  it.each([
    ["url https://api.x.com/v1?api_key=abcd1234efgh&x=1", "api_key=[redacted]"],
    ["https://api.x.com/v1?access_token=abcd1234efgh", "access_token=[redacted]"],
    ["https://api.x.com/v1?token=abcd1234efgh", "token=[redacted]"],
    ["https://api.x.com/v1?foo=1&token=abcd1234efgh", "token=[redacted]"],
    ["https://x.com/callback?code=x&access_token=abcd1234efgh", "access_token=[redacted]"],
    ["ws://host/socket?token=abcd1234efgh", "token=[redacted]"],
    ["jdbc:postgresql://db/app?user=app&password=hunter2hunter2", "password=[redacted]"],
    ["env: OPENAI_API_KEY=abcd1234efgh5678", "OPENAI_API_KEY=[redacted]"],
    ["env:API_KEY=abcd1234efgh5678", "API_KEY=[redacted]"],
    ["user=admin:password=hunter2hunter2", "password=[redacted]"],
    ["a=b&password=hunter2hunter2", "password=[redacted]"],
    ["x:y:token=abcd1234efgh", "token=[redacted]"],
    ["Note:token=abcd1234efgh", "token=[redacted]"],
    ["--header=Authorization:Bearer_abcd1234efgh5678", "Authorization:[redacted]"],
  ])("%s", (input, kept) => {
    const out = scrub(input);
    expect(out).toContain(kept);
    expect(out).not.toMatch(/abcd1234efgh|hunter2hunter2/u);
  });
});

describe("scrubber: cheap extra shapes go", () => {
  it.each([
    ["redis://:p4ss1234@cache:6379", "redis://:[redacted]@cache:6379"],
    ["DB_PASS=hunter2hunter2", "DB_PASS=[redacted]"],
    ["tool --token plainvalue1 --verbose", "tool --token [redacted] --verbose"],
    ["mysqldump --password hunter2pass db", "mysqldump --password [redacted] db"],
    ["curl -u admin:hunter2pass https://x", "curl -u admin:[redacted] https://x"],
    ["https://hooks.slack.com/services/T000/B000/XXXXyyyyZZZZ", "https://hooks.slack.com/services/[redacted]"],
  ])("%s", (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });
});

describe("scrubber: sizes, rules and code stay", () => {
  it.each([
    "token_count: 512",
    "token_budget: 150000",
    "password_min_length: 12",
    "PasswordReset: component",
    "sort key: created_at",
    "const SECRET_WORD = /x/;",
    "const sessionId = crypto.randomUUID();",
    "sessionId: thread.id,",
    "sessionKey: makeKey(thread),",
    "token: z.string()",
    "authToken: getToken()",
    "pass: 3",
    "--token-file ./t.txt",
  ])("%s", (text) => {
    expect(scrub(text)).toBe(text);
  });
});
