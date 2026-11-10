import assert from "node:assert/strict";
import { test } from "node:test";
import {
  caffeinateArgs,
  expandHome,
  keychainProblem,
  MASK,
  maskArgs,
  notaryApiKey,
  notaryArgs,
  parseEnvFile,
} from "./release-unattended.mjs";

const HOME = "/home/tester";
const FILE = `${HOME}/.config/bbgo/testflight.env`;

function reader(files) {
  return (path) => files[path] ?? null;
}

test("expandHome expands a leading tilde only", () => {
  assert.equal(expandHome("~/keys/a.p8", HOME), `${HOME}/keys/a.p8`);
  assert.equal(expandHome("~", HOME), HOME);
  assert.equal(expandHome("/abs/~/a.p8", HOME), "/abs/~/a.p8");
});

test("parseEnvFile reads export lines, quotes and comments", () => {
  assert.deepEqual(
    parseEnvFile('# c\nexport ASC_KEY_ID="KID"\nASC_ISSUER_ID=\'ISS\'\n\nASC_KEY_PATH = ~/k.p8\njunk\n'),
    { ASC_KEY_ID: "KID", ASC_ISSUER_ID: "ISS", ASC_KEY_PATH: "~/k.p8" },
  );
});

test("the env vars win and the file is not read", () => {
  let read = 0;
  const key = notaryApiKey({
    env: {
      BB_STUDIO_NOTARY_KEY_PATH: "~/env.p8",
      BB_STUDIO_NOTARY_KEY_ID: "ENVID",
      BB_STUDIO_NOTARY_ISSUER: "ENVISS",
    },
    home: HOME,
    readFile: () => {
      read += 1;
      return null;
    },
  });
  assert.equal(read, 0);
  assert.deepEqual(key, {
    keyPath: `${HOME}/env.p8`,
    keyId: "ENVID",
    issuer: "ENVISS",
    source: "env BB_STUDIO_NOTARY_KEY_PATH, _KEY_ID, _ISSUER",
  });
});

test("the testflight.env file fills in with ~ expanded", () => {
  const key = notaryApiKey({
    env: {},
    home: HOME,
    readFile: reader({
      [FILE]: "ASC_KEY_PATH=~/.keys/AuthKey_FID.p8\nASC_KEY_ID=FID\nASC_ISSUER_ID=FISS\n",
    }),
  });
  assert.deepEqual(key, {
    keyPath: `${HOME}/.keys/AuthKey_FID.p8`,
    keyId: "FID",
    issuer: "FISS",
    source: "~/.config/bbgo/testflight.env",
  });
});

test("a partial env is completed from the file", () => {
  const key = notaryApiKey({
    env: { BB_STUDIO_NOTARY_KEY_ID: "ENVID" },
    home: HOME,
    readFile: reader({ [FILE]: "ASC_KEY_PATH=/k.p8\nASC_KEY_ID=FID\nASC_ISSUER_ID=FISS\n" }),
  });
  assert.equal(key.keyId, "ENVID");
  assert.equal(key.keyPath, "/k.p8");
  assert.equal(key.issuer, "FISS");
});

test("no key configured falls back to the keychain profile", () => {
  assert.equal(notaryApiKey({ env: {}, home: HOME, readFile: reader({}) }), null);
  assert.equal(
    notaryApiKey({ env: {}, home: HOME, readFile: reader({ [FILE]: "ASC_KEY_ID=FID\n" }) }),
    null,
  );
  assert.deepEqual(notaryArgs("a.dmg", null, "bbstudio-notary"), [
    "notarytool",
    "submit",
    "a.dmg",
    "--keychain-profile",
    "bbstudio-notary",
    "--wait",
  ]);
});

test("notaryArgs uses the API key and maskArgs hides every value", () => {
  const key = {
    keyPath: "/secret/AuthKey_KID123.p8",
    keyId: "KID123",
    issuer: "ISSUER-UUID",
    source: "x",
  };
  const argv = notaryArgs("a.dmg", key, "unused");
  assert.deepEqual(argv, [
    "notarytool",
    "submit",
    "a.dmg",
    "--key",
    key.keyPath,
    "--key-id",
    "KID123",
    "--issuer",
    "ISSUER-UUID",
    "--wait",
  ]);
  const masked = maskArgs(argv, key);
  assert.deepEqual(masked, [
    "notarytool",
    "submit",
    "a.dmg",
    "--key",
    MASK,
    "--key-id",
    MASK,
    "--issuer",
    MASK,
    "--wait",
  ]);
  const text = maskArgs(["id KID123 by ISSUER-UUID with /secret/AuthKey_KID123.p8"], key)[0];
  for (const value of [key.keyPath, key.keyId, key.issuer]) {
    assert.ok(!text.includes(value));
  }
});

test("caffeinate waits on the given pid", () => {
  assert.deepEqual(caffeinateArgs(4242), ["-i", "-w", "4242"]);
});

test("keychainProblem reports a locked keychain and a missing identity", () => {
  const ok = 'Developer ID Application: Someone (TEAM)';
  assert.match(
    keychainProblem({ keychainStatus: 36, identities: ok, cscName: ok }),
    /locked/,
  );
  assert.match(keychainProblem({ keychainStatus: 0, identities: ok, cscName: "" }), /set CSC_NAME/);
  assert.match(
    keychainProblem({ keychainStatus: 0, identities: "", cscName: ok }),
    /not a valid signing identity/,
  );
  assert.equal(keychainProblem({ keychainStatus: 0, identities: `1) ABC "${ok}"`, cscName: ok }), null);
});
