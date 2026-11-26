import { experimental_execHostFile } from "@get-bb/plugin-sdk/process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const KEYCHAIN_SERVICE = "gemini";
const KEYCHAIN_ACCOUNT = "antigravity";
const GO_KEYRING_BASE64_PREFIX = "go-keyring-base64:";
const KEYCHAIN_TIMEOUT_MS = 10_000;

const keyringPayloadSchema = z
  .object({
    token: z
      .object({
        access_token: z.string().min(1),
        expiry: z.string().optional(),
      })
      .passthrough(),
    auth_method: z.string().optional(),
    id_token_email: z.string().email().optional(),
  })
  .passthrough();

const fallbackFileSchema = z
  .object({
    access_token: z.string().min(1),
    expiry_date: z.number().optional(),
    email: z.string().email().optional(),
  })
  .passthrough();

export interface AntigravityCredentials {
  accessToken: string;
  email: string | null;
  authMethod: string | null;
  expired: boolean;
}

export function parseKeyringSecret(raw: string): AntigravityCredentials | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let jsonText = trimmed;
  if (trimmed.startsWith(GO_KEYRING_BASE64_PREFIX)) {
    const encoded = trimmed.slice(GO_KEYRING_BASE64_PREFIX.length);
    try {
      jsonText = Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return null;
    }
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const parsed = keyringPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) return null;

  const expiryMs = parsed.data.token.expiry
    ? Date.parse(parsed.data.token.expiry)
    : Number.NaN;
  const expired = Number.isFinite(expiryMs) && expiryMs <= Date.now();

  return {
    accessToken: parsed.data.token.access_token,
    email: parsed.data.id_token_email ?? null,
    authMethod: parsed.data.auth_method ?? null,
    expired,
  };
}

async function readMacKeychainSecret(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await experimental_execHostFile(
      "security",
      [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
        "-w",
      ],
      { timeout: KEYCHAIN_TIMEOUT_MS },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readFallbackFileCredentials(): Promise<AntigravityCredentials | null> {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".gemini", "antigravity-cli", "oauth_creds.json"),
    path.join(home, ".gemini", "oauth_creds.json"),
  ];
  for (const filePath of candidates) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const fromKeyringFormat = parseKeyringSecret(raw);
    if (fromKeyringFormat !== null) return fromKeyringFormat;

    try {
      const parsed = fallbackFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) continue;
      const expired =
        parsed.data.expiry_date !== undefined &&
        parsed.data.expiry_date <= Date.now();
      return {
        accessToken: parsed.data.access_token,
        email: parsed.data.email ?? null,
        authMethod: null,
        expired,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function readAntigravityCredentials(): Promise<AntigravityCredentials | null> {
  const secret = await readMacKeychainSecret();
  if (secret !== null) {
    const parsed = parseKeyringSecret(secret);
    if (parsed !== null) return parsed;
  }
  return readFallbackFileCredentials();
}
