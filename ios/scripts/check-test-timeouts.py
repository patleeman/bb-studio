#!/usr/bin/env python3
"""Fail the build when a test could run past its 5-minute limit.

- Every XCTestCase subclass in UITests/ inherits ServerIsolatedUITestCase,
  which sets executionTimeAllowance and starts the watchdog.
- Nothing else sets executionTimeAllowance, and the base class's limit is
  at most 300 seconds.
- Every `xcodebuild test` or `test-without-building` in the scripts passes
  the timeout flags, so XCTest itself fails a test at the limit.
"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parents[1]
BASE = "ServerIsolatedUITestCase"
LIMIT = 300
FLAGS = (
    "-test-timeouts-enabled YES",
    f"-default-test-execution-time-allowance {LIMIT}",
    f"-maximum-test-execution-time-allowance {LIMIT}",
)
errors = []

# 1. Classes: each one's chain of superclasses reaches the base.
declaration = re.compile(r"^\s*(?:(?:final|open|public|internal|private|fileprivate|@\w+)\s+)*class\s+(\w+)\s*:\s*([\w.]+)", re.M)
parents = {}
where = {}
for path in sorted((root / "UITests").rglob("*.swift")):
    source = path.read_text()
    for match in declaration.finditer(source):
        name, parent = match.groups()
        parents[name] = parent
        where[name] = f"{path.relative_to(root)}:{source.count(chr(10), 0, match.start()) + 1}"
    lines = source.splitlines()
    for number, line in enumerate(lines, 1):
        # A setUp that doesn't call super's skips the base's limit and watchdog.
        if re.search(r"override\s+func\s+setUp(?:WithError)?\s*\(", line):
            body = "\n".join(lines[number:number + 4])
            if not re.search(r"super\.setUp(?:WithError)?\(\)", line + body):
                errors.append(f"UITests/{path.name}:{number}: setUp must call super.setUp first")
        if "executionTimeAllowance" in line and not line.lstrip().startswith("//") and path.name != "StagedServerUITestCase.swift":
            errors.append(f"UITests/{path.name}:{number}: only {BASE} sets executionTimeAllowance")


def reaches_base(name):
    seen = set()
    while name in parents and name not in seen:
        if name == BASE:
            return True
        seen.add(name)
        name = parents[name]
    return name == BASE


for name, parent in parents.items():
    if name == BASE:
        if parent != "XCTestCase":
            errors.append(f"{where[name]}: {BASE} must inherit XCTestCase")
        continue
    # A class whose chain ends outside UITests (XCTestCase, XCTest.XCTestCase, a
    # typealias) skips the limit; helpers that aren't test cases have no chain here.
    chain_end = parent
    while chain_end in parents and chain_end != BASE:
        chain_end = parents[chain_end]
    if not reaches_base(name) and ("XCTestCase" in chain_end or chain_end.endswith("TestCase")):
        errors.append(f"{where[name]}: {name} must inherit {BASE} (directly or through StagedServerUITestCase)")

base = (root / "UITests/StagedServerUITestCase.swift").read_text()
limit = re.search(r"static let timeLimit: TimeInterval = (\d+)", base)
if not limit or int(limit.group(1)) > LIMIT:
    errors.append(f"UITests/StagedServerUITestCase.swift: {BASE}.timeLimit must be at most {LIMIT}")
for needle in ("executionTimeAllowance = Self.timeLimit", "TestWatchdog(name:"):
    if needle not in base:
        errors.append(f"UITests/StagedServerUITestCase.swift: {BASE}.setUpWithError must keep `{needle}`")

# 2. Scripts: each test run passes the timeout flags.
scripts = sorted((root / "scripts").glob("*.sh")) + sorted((root / "docs").rglob("*.sh"))
for path in scripts:
    lines = path.read_text().splitlines()
    number = 0
    while number < len(lines):
        start = number
        command = lines[number]
        while command.rstrip().endswith("\\") and number + 1 < len(lines):
            number += 1
            command = command.rstrip()[:-1] + " " + lines[number]
        number += 1
        if command.lstrip().startswith("#"):
            continue
        if re.search(r"\bxcodebuild\b.*\b(?:test|test-without-building)\b(?!-)", command) and "build-for-testing" not in command:
            missing = [flag for flag in FLAGS if flag not in " ".join(command.split())]
            if missing:
                errors.append(f"{path.relative_to(root)}:{start + 1}: xcodebuild test without {', '.join(missing)}")

if errors:
    sys.exit("Test time limits:\n" + "\n".join(errors))
print(f"iOS test time limits passed ({sum(1 for n in parents if reaches_base(n)) - 1} UI test classes under {BASE})")
