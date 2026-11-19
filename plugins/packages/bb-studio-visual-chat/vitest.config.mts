export default {
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    passWithNoTests: false,
    // One temp root per run, removed at the end (see the script).
    globalSetup: ["../../scripts/vitest-temp-root.mjs"],
  },
};
