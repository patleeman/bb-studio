import assert from "node:assert/strict";
import { test } from "node:test";
import { telemetrySwitchProblems } from "./identity-absent.mjs";

const VIEW = "apps/app/src/views/SettingsView.tsx";
const SEARCH = "apps/app/src/components/settings/settings-search.ts";

const view = (label) => `
        <SettingsWithControl
          label="${label}"
          description="Send anonymous usage data to help improve bb."
        >
          <Switch
            checked={telemetryEnabled}
            disabled={disabled}
            onCheckedChange={onTelemetryEnabledChange}
            aria-label="${label}"
          />
        </SettingsWithControl>`;

const search = (title) => `
      {
        title: "${title}",
        keywords: ["privacy", "telemetry", "analytics"],
      },`;

test("finds bb's usage data switch and its search entry", () => {
  assert.equal(
    telemetrySwitchProblems([
      { path: VIEW, text: view("Share anonymous usage data") },
      { path: SEARCH, text: search("Share anonymous usage data") },
    ]).length,
    2,
  );
});

test("still finds them after upstream renames the label", () => {
  const problems = telemetrySwitchProblems([
    { path: VIEW, text: view("Help improve bb") },
    { path: SEARCH, text: search("Help improve bb") },
  ]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /bound to a telemetry setting/);
});

test("finds the switch when it moves to another file or binds another telemetry value", () => {
  assert.equal(
    telemetrySwitchProblems([
      {
        path: "apps/app/src/components/settings/PrivacySection.tsx",
        text: "<Switch checked={settings.shareTelemetry} />",
      },
    ]).length,
    1,
  );
});

test("is quiet once the switch and the entry are gone", () => {
  assert.deepEqual(
    telemetrySwitchProblems([
      { path: VIEW, text: "telemetryEnabled: boolean;" },
      {
        path: SEARCH,
        text: '{ title: "Streamer mode", keywords: ["privacy"] },',
      },
    ]),
    [],
  );
});
