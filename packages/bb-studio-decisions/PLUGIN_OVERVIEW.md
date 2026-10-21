Decisions is built into Studio. This upgrade bridge copies the old settings, five secret API keys and fallback/recent-decision KV into Studio without overwriting existing values. It retries until Studio acknowledges the copy.

The bridge forwards every old RPC and `bb smart-decisions` command. It runs no queue hook or classifiers. Keep it while old scripts need the CLI alias. Update the bridge first, then Studio, and run `bb smart-decisions migrate`. Studio Setup marks it safe to remove only after migration.
