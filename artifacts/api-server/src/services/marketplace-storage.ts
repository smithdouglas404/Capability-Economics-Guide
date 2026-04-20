import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * File storage for marketplace uploads. Today this writes to a directory on
 * the local filesystem (or Railway volume when MARKETPLACE_STORAGE_DIR is set
 * to a mount path). The interface is deliberately S3-compatible so we can
 * swap the backend later without touching callers.
 *
 * Files are never served directly — the download endpoint streams them with
 * a watermark overlay and an entitlement check, so no signed URLs are needed.
 */
const DEFAULT_DIR = "/tmp/marketplace-uploads";

function baseDir(): string {
  return process.env.MARKETPLACE_STORAGE_DIR ?? DEFAULT_DIR;
}

export async function ensureStorageDir(): Promise<void> {
  await fs.mkdir(baseDir(), { recursive: true });
}

export async function saveUpload(buffer: Buffer, originalName: string): Promise<{ key: string; size: number }> {
  await ensureStorageDir();
  const hash = crypto.randomBytes(16).toString("hex");
  const ext = path.extname(originalName) || ".bin";
  const key = `${hash}${ext}`;
  const fullPath = path.join(baseDir(), key);
  await fs.writeFile(fullPath, buffer);
  return { key, size: buffer.length };
}

export async function readFile(key: string): Promise<Buffer> {
  // Paranoid path check — never let a caller escape baseDir via traversal.
  if (key.includes("..") || path.isAbsolute(key)) {
    throw new Error("invalid_file_key");
  }
  const fullPath = path.join(baseDir(), key);
  return fs.readFile(fullPath);
}

export async function deleteFile(key: string): Promise<void> {
  if (key.includes("..") || path.isAbsolute(key)) return;
  const fullPath = path.join(baseDir(), key);
  try { await fs.unlink(fullPath); } catch { /* ignore */ }
}
