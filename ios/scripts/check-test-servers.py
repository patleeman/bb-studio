#!/usr/bin/env python3
"""Fail builds before tests can use a hard-coded BB origin or saved app origin."""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parents[1]
errors = []
paths = [path for directory in ("Tests", "UITests")
         for path in sorted((root / directory).rglob("*.swift"))]
paths += [root / "scripts/test.sh", root / "scripts/share-runtime.sh"]
for path in paths:
    source = path.read_text()
    for number, line in enumerate(source.splitlines(), 1):
        # No numeric port is allowed in an HTTP(S)/WS(S) test origin.
        # Mock transports use reserved .invalid/.test hosts without ports.
        if (re.search(r'(?:https?|wss?)://[^\s"/]+:\d+', line)
                or re.search(r'(?:127(?:\.\d+){3}|localhost|\[::1\]):\d+', line)):
            errors.append(f"{path}:{number}: hard-coded server port; use BBGO_QA_SERVER")
        if path.parent.name == "UITests" and path.name != "StagedServerUITestCase.swift":
            if re.search(r'\bapp\.launch\(\)', line):
                errors.append(f"{path}:{number}: use launchOffline() or launchStaged(server: qaServer)")
            if re.search(r':\s*XCTestCase\b', line):
                errors.append(f"{path}:{number}: UI tests must inherit ServerIsolatedUITestCase or StagedServerUITestCase")
if errors:
    sys.exit("\n".join(errors))
print("iOS test server guard passed")
