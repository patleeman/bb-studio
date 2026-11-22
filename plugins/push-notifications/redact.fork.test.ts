import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.fork.js";
import { createPushNotificationsPlugin } from "./server.js";

const RELAY_TOKEN = "bbpt_relay0123456789abcdefRELAYSECRET9z";
const DEVICE_TOKEN = "ExponentPushToken[deviceSecret0123456789XyZ]";
const APNS_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9d";
const RELAY_URL = `http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=${RELAY_TOKEN}`;

async function setup() {
  const fake = createFakePluginHost({
    pluginId: "push-notifications",
    settings: { expoPushUrl: RELAY_URL },
  });
  let nextId = 1;
  await createPushNotificationsPlugin({
    createId: () => `subscription-${nextId++}`,
  })(fake.bb);
  for (const token of [DEVICE_TOKEN, `apns:${APNS_HEX}`]) {
    await fake.harness.behavior.callRpc("pushSubscriptions.add", {
      expoPushToken: token,
      platform: "ios",
      deviceLabel: "Phone",
    });
  }
  return fake;
}

function expectNoSecret(output: string) {
  expect(output).not.toContain(RELAY_TOKEN);
  expect(output).not.toContain(RELAY_TOKEN.slice(0, 12));
  expect(output).not.toContain("deviceSecret");
  expect(output).not.toContain(APNS_HEX.slice(0, 16));
}

describe("push-notifications status never shows a token (fork)", () => {
  it("redacts the relay URL's token in text and JSON", async () => {
    const fake = await setup();
    try {
      const text = await fake.harness.behavior.runCli(["status"]);
      expect(text.exitCode).toBe(0);
      expectNoSecret(text.stdout ?? "");
      expect(text.stdout).toContain(
        "Relay URL: http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=[redacted …ET9z]",
      );
      const json = await fake.harness.behavior.runCli(["status", "--json"]);
      expectNoSecret(json.stdout ?? "");
      expect(JSON.parse(json.stdout ?? "{}")).toMatchObject({
        relayUrl:
          "http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=[redacted …ET9z]",
        subscriptionCount: 2,
      });
      for (const argv of [["list"], ["list", "--json"]]) {
        expectNoSecret((await fake.harness.behavior.runCli(argv)).stdout ?? "");
      }
    } finally {
      await fake.harness.lifecycle.dispose();
    }
  });
});

describe("redactSecrets (fork)", () => {
  it("redacts credential query parameters and user info", () => {
    expect(redactSecrets(RELAY_URL)).toBe(
      "http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=[redacted …ET9z]",
    );
    expect(redactSecrets("https://x.test/a?b=1&api_key=short&c=2")).toBe(
      "https://x.test/a?b=1&api_key=[redacted]&c=2",
    );
    expect(redactSecrets("https://me:hunter2@x.test/")).toBe(
      "https://[redacted]@x.test/",
    );
    expect(redactSecrets("https://exp.host/--/api/v2/push/send")).toBe(
      "https://exp.host/--/api/v2/push/send",
    );
  });

  it("redacts Expo and APNs device tokens", () => {
    expect(
      redactSecrets(`"${DEVICE_TOKEN}" is not a registered push notification recipient`),
    ).toBe(
      '"ExponentPushToken[[redacted …9XyZ]]" is not a registered push notification recipient',
    );
    expect(redactSecrets(`apns:${APNS_HEX}`)).toBe("apns:[redacted …8f9d]");
    expect(redactSecrets(`token ${APNS_HEX} gone`)).toBe(
      "token [redacted …8f9d] gone",
    );
  });

  it("changes nothing when run twice", () => {
    for (const text of [
      RELAY_URL,
      DEVICE_TOKEN,
      `apns:${APNS_HEX}`,
      "https://me:pw@x.test/?key=abc",
      encodeURI(redactSecrets(RELAY_URL)),
    ]) {
      const once = redactSecrets(text);
      expect(redactSecrets(once)).toBe(once);
    }
  });
});
