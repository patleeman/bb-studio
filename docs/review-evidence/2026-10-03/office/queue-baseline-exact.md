# Queue removal: exact pre-restructure baseline

**Pre-existing failure; no bisect is needed.**

The unmodified `e81d75b` app and `testQueueRemove` ran against stable BB 0.45.0
with **all 17 plugins installed from `e81d75b`**. This closes the plugin-version
gap in the earlier baseline, which used the old app against the six-plugin server.

- Isolated server: `http://127.0.0.1:52686`.
- Private simulator: `CF1B0476-6432-46CB-8EB3-255297208A71`.
- Result: one test, one failure, `queued card removed`.
- Server queue after the tap: empty (`[]`).
- Bundle: `/tmp/queue-exact-baseline.xcresult`.
- Log: `/tmp/queue-exact-baseline-test.log`.
- [Exact plugin revisions and fixture IDs](queue-baseline-exact.json).

The baseline app/test binary is the previously built `git archive e81d75b`
export at `/tmp/office-ui-baseline`. Its xctestrun environment was copied and
pointed at the new baseline server. The baseline repository's staged installer
was exported separately; only its Git provenance lookup was adapted for the
archive, which has no `.git` directory. App and plugin code were unchanged.

No queue product code was changed in this verification. The independent worker's
already-committed `629d48f6` fix was left untouched; the result here classifies
the original failure as pre-existing, not an Office regression.
