import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const NOTARY_ENV_FILE = "~/.config/bbgo/testflight.env";
export const MASK = "***";

export function expandHome(path, home = homedir()) {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

export function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value.at(-1) === value[0]
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export function notaryApiKey({
  env = process.env,
  home = homedir(),
  readFile = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
} = {}) {
  const fromEnv = {
    keyPath: env.BB_STUDIO_NOTARY_KEY_PATH?.trim() ?? "",
    keyId: env.BB_STUDIO_NOTARY_KEY_ID?.trim() ?? "",
    issuer: env.BB_STUDIO_NOTARY_ISSUER?.trim() ?? "",
  };
  const file = expandHome(NOTARY_ENV_FILE, home);
  const text =
    fromEnv.keyPath && fromEnv.keyId && fromEnv.issuer ? null : readFile(file);
  const fromFile = text === null ? {} : parseEnvFile(text);
  const pick = (own, key) => own || (fromFile[key]?.trim() ?? "");
  const keyPath = pick(fromEnv.keyPath, "ASC_KEY_PATH");
  const keyId = pick(fromEnv.keyId, "ASC_KEY_ID");
  const issuer = pick(fromEnv.issuer, "ASC_ISSUER_ID");
  if (!keyPath || !keyId || !issuer) return null;
  const source =
    fromEnv.keyPath && fromEnv.keyId && fromEnv.issuer
      ? "env BB_STUDIO_NOTARY_KEY_PATH, _KEY_ID, _ISSUER"
      : NOTARY_ENV_FILE;
  return { keyPath: expandHome(keyPath, home), keyId, issuer, source };
}

export function notaryArgs(dmg, apiKey, profile) {
  if (apiKey === null) {
    return ["notarytool", "submit", dmg, "--keychain-profile", profile, "--wait"];
  }
  return [
    "notarytool",
    "submit",
    dmg,
    "--key",
    apiKey.keyPath,
    "--key-id",
    apiKey.keyId,
    "--issuer",
    apiKey.issuer,
    "--wait",
  ];
}

export function maskArgs(argv, apiKey) {
  if (apiKey === null) return [...argv];
  const secrets = [apiKey.keyPath, apiKey.keyId, apiKey.issuer];
  return argv.map((arg) => {
    let out = arg;
    for (const secret of secrets) {
      if (secret) out = out.split(secret).join(MASK);
    }
    return out;
  });
}

export function caffeinateArgs(pid) {
  return ["-i", "-w", String(pid)];
}

export function keychainProblem({ keychainStatus, identities, cscName }) {
  if (keychainStatus !== 0) {
    return "the login keychain is locked: unlock the Mac once (log in) and run again";
  }
  if (!cscName) return "set CSC_NAME to the Developer ID Application identity";
  if (!identities.includes(cscName)) {
    return "CSC_NAME is not a valid signing identity in the keychain";
  }
  return null;
}
