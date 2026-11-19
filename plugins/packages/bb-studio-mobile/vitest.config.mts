export default {
  test: {
    // One temp root per run, removed at the end (see the script).
    globalSetup: ["../../scripts/vitest-temp-root.mjs"],
  },
};
