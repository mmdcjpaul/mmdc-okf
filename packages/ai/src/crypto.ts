import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "v1";

/** The 32-byte key from `APP_ENCRYPTION_KEY`, given as 64 hex characters or base64. */
export function parseEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32)
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64");
  return key;
}

/**
 * Encrypts a provider key for storage in `settings`, with AES-256-GCM. The result carries
 * its own nonce and authentication tag, so a value that was tampered with does not decrypt.
 * `context` binds the ciphertext to where it is stored: a key saved for one provider cannot
 * be moved to another.
 */
export function encryptSecret(plaintext: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [PREFIX, iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(stored: string, key: Buffer, context: string): string {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== PREFIX || !iv || !tag || body === undefined)
    throw new Error("The stored secret is not in a format this version can read");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("The stored secret could not be decrypted: wrong key, or it was changed");
  }
}

/** What Admin shows for a stored key: enough to recognise it, never enough to use it. */
export function maskSecret(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return plaintext.length > 12 ? `…${tail}` : "…";
}
