import "server-only";
import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { UserError } from "@/lib/services/errors";
import { log } from "@/lib/log";

// Private file storage. With S3_* set it uses any S3-compatible bucket (AWS S3, Cloudflare R2,
// DigitalOcean Spaces, MinIO); otherwise files go to a folder on the server (STORAGE_DIR, default
// ./storage), which must be on a persistent disk. A host with no disk (Vercel) and no bucket keeps
// files in the database (StoredFile), so backups, photos and documents still work until a bucket is
// connected. Objects are never public: the app reads them back itself after a permission check.

const env = (k: string) => process.env[k]?.trim() || "";

export type S3Config = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };

function s3Config(): S3Config | null {
  const c = { endpoint: env("S3_ENDPOINT"), bucket: env("S3_BUCKET"), region: env("S3_REGION") || "auto", accessKeyId: env("S3_ACCESS_KEY_ID"), secretAccessKey: env("S3_SECRET_ACCESS_KEY") };
  return c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey ? c : null;
}

/** Where files go: the bucket, the server's folder, or (on a host with no disk and no bucket) the database. */
export const storageMode = (): "S3" | "DISK" | "DATABASE" => (s3Config() ? "S3" : env("VERCEL") ? "DATABASE" : "DISK");

const S3_KEYS = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

/**
 * What is wrong with the storage set-up, in the host's terms (setting names, deploy notes), or null. For the server
 * log and whoever runs the server; never shown to a gym, whose staff can't change server settings.
 */
export function storageDetail(): string | null {
  if (s3Config()) return null;
  const set = S3_KEYS.filter((k) => env(k));
  const missing = S3_KEYS.filter((k) => !env(k));
  if (set.length) return `S3 storage is half set up: ${set.join(", ")} set but ${missing.join(", ")} missing.`;
  if (env("VERCEL")) return "No S3_* bucket settings on a host without a disk; files are kept in the database (deploy/VERCEL.md step 1.5).";
  return null;
}

let told = false;

/**
 * Why files cannot be saved right now, in words a gym owner understands, or null when storage is usable. Exported for
 * the Backup tab, so the problem shows before anyone tries an upload. The technical reason goes to the server log.
 */
export function storageProblem(): string | null {
  const detail = storageDetail();
  if (detail && !told) {
    told = true;
    log.warn("storage.config", undefined, { detail });
  }
  // Without a disk, files go to the database instead, so nothing is blocked.
  if (!detail || storageMode() === "DATABASE") return null;
  return "File storage on this server is not fully connected, so backups, photos and documents can't be saved yet. Fitron support has the details; write to support@fitron.in if this stays.";
}

/** The largest file kept in the database when there is no bucket; bigger ones need a bucket. */
const DB_FILE_MAX = 50 * 1024 * 1024;

/** The message shown when a write to the server's folder fails: the disk is full, read-only, or this host has none. */
const DISK_WRITE_FAILED = "Could not save the file: the server's file storage is full or not writable. Ask whoever hosts Fitron (or support) to check the storage folder or connect a bucket.";

const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, s: string) => createHmac("sha256", k).update(s).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** AWS Signature Version 4 headers for one request (path-style URL). Exported for its test. */
export function signV4(a: { method: string; url: URL; headers: Record<string, string>; payloadHash: string; region: string; accessKeyId: string; secretAccessKey: string; now: Date }) {
  const amzDate = a.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...a.headers, host: a.url.host, "x-amz-content-sha256": a.payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalHeaders = names.map((h) => `${h}:${lower[h]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...a.url.searchParams.entries()]
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .sort()
    .join("&");
  const canonicalPath = a.url.pathname.split("/").map((p) => enc(decodeURIComponent(p))).join("/");
  const canonical = [a.method, canonicalPath, query, canonicalHeaders, signedHeaders, a.payloadHash].join("\n");
  const scope = `${day}/${a.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${a.secretAccessKey}`, day), a.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${a.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

async function s3(c: S3Config, method: "PUT" | "GET" | "DELETE", key: string, body?: Uint8Array, contentType?: string) {
  const url = new URL(`${c.endpoint.replace(/\/$/, "")}/${c.bucket}/${key.split("/").map(enc).join("/")}`);
  const payloadHash = sha256(body ?? "");
  const headers = signV4({ method, url, headers: contentType ? { "content-type": contentType } : {}, payloadHash, region: c.region, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, now: new Date() });
  delete (headers as Record<string, string>).host;
  const res = await fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined, signal: AbortSignal.timeout(30_000) });
  if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`Storage ${method} failed: ${res.status}`);
  return res;
}

// The folder is only known at run time (STORAGE_DIR) and is only used on a server with a disk. The ignore comments tell the
// bundler so: without them it warns, and treats every file in the project as one this code might read, so on Vercel each
// function would carry the whole project.
const diskPath = (key: string) => {
  const root = path.resolve(/*turbopackIgnore: true*/ env("STORAGE_DIR") || "storage");
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new Error("Bad storage key");
  return p;
};

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  const c = s3Config();
  if (c) return void (await s3(c, "PUT", key, body, contentType));
  if (storageMode() === "DATABASE") {
    if (body.byteLength > DB_FILE_MAX) throw new UserError("That file is too large to save on this server. Write to support@fitron.in to connect larger file storage.");
    const data = { body: Buffer.from(body), contentType, size: body.byteLength };
    await db.storedFile.upsert({ where: { key }, create: { key, ...data }, update: data });
    return;
  }
  const problem = storageProblem();
  if (problem) throw new UserError(problem);
  const p = diskPath(key);
  try {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  } catch (e) {
    log.error("storage.write_failed", e, { key });
    throw new UserError(DISK_WRITE_FAILED);
  }
}

export async function getObject(key: string): Promise<Uint8Array> {
  const c = s3Config();
  if (c) return new Uint8Array(await (await s3(c, "GET", key)).arrayBuffer());
  if (storageMode() === "DATABASE") {
    const f = await db.storedFile.findUnique({ where: { key }, select: { body: true } });
    if (!f) throw new Error(`Stored file not found: ${key}`);
    return new Uint8Array(f.body);
  }
  return readFile(/*turbopackIgnore: true*/ diskPath(key));
}

export async function deleteObject(key: string) {
  const c = s3Config();
  if (c) return void (await s3(c, "DELETE", key));
  if (storageMode() === "DATABASE") return void (await db.storedFile.deleteMany({ where: { key } }));
  await rm(diskPath(key), { force: true });
}

/** What the bytes actually are, whatever the file name says. Only these types are accepted. */
export function sniffType(b: Uint8Array): { mime: string; ext: string } | null {
  const hex = Buffer.from(b.subarray(0, 12)).toString("hex");
  if (hex.startsWith("25504446")) return { mime: "application/pdf", ext: "pdf" };
  if (hex.startsWith("ffd8ff")) return { mime: "image/jpeg", ext: "jpg" };
  if (hex.startsWith("89504e470d0a1a0a")) return { mime: "image/png", ext: "png" };
  if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") return { mime: "image/webp", ext: "webp" };
  if (hex.slice(8, 16) === "66747970" && /^(68656963|68656978|6d696631|6d736631)/.test(hex.slice(16, 24))) return { mime: "image/heic", ext: "heic" };
  return null;
}
