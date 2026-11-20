import { expect, it } from "vitest";
import { ONBOARDING_MAX_BACKOFF_MS, ONBOARDING_POLL_MS, onboardingDelay, onboardingProblem } from "./onboarding-register";

it("backs off while onboarding keeps failing, doubling up to 5 minutes, and polls again once it works", () => {
  expect(onboardingDelay(0)).toBe(ONBOARDING_POLL_MS);
  expect(onboardingDelay(1)).toBe(10_000);
  expect(onboardingDelay(2)).toBe(20_000);
  expect(onboardingDelay(6)).toBe(ONBOARDING_MAX_BACKOFF_MS);
  expect(onboardingDelay(40)).toBe(ONBOARDING_MAX_BACKOFF_MS);
});

it("says in plain words why the first chat didn't start and when it tries again", () => {
  expect(onboardingProblem("Host is not connected", 20_000)).toBe("Your Bot's first chat didn't start yet (Host is not connected). Trying again in 20 s.");
  expect(onboardingProblem("Host is not connected", ONBOARDING_MAX_BACKOFF_MS)).toBe("Your Bot's first chat didn't start yet (Host is not connected). Trying again in 5 min.");
});
