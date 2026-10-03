#!/bin/bash
# Focused entry point for the same isolated Share harness used by the full suite.
set -euo pipefail
: "${BB_QA_DATA_DIR:?Set the temporary staged data directory to prepare the Share host}"
export BB_UI_TEST_ONLY=BBStudioUITests/ShareRuntimeUITests
exec bash "$(dirname "$0")/ui-test.sh" "$@"
