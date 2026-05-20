import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const keyHex = process.env.TELEGRAM_TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error("TELEGRAM_TOKEN_ENCRYPTION_KEY env var is required");
  }
  if (keyHex.length !== 64) {
    throw new Error("TELEGRAM_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  }
  return Buffer.from(keyHex, "hex");
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(
    ":",
  );
}

export function decryptToken(payload: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted token format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}
