import { canonicalize, type CanonicalizeOptions } from "./canonicalize.js";
import { CanonJsonError } from "./errors.js";

export type HashAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
export type HashEncoding = "hex" | "base64" | "base64url";

export type HashOptions = CanonicalizeOptions & {
  /** Digest algorithm. Default `"SHA-256"`. */
  readonly algorithm?: HashAlgorithm;
  /** Output encoding. Default `"hex"`. */
  readonly encoding?: HashEncoding;
};

const encoder = new TextEncoder();

/**
 * Cryptographic, deterministic hash of any JSON‑compatible value.
 * Two structurally equal values (regardless of key order) always hash the same.
 *
 * Uses WebCrypto (`crypto.subtle`), so it works in browsers, Node ≥ 18, Deno,
 * Bun, Cloudflare Workers, and Vercel Edge. For a synchronous Node‑only
 * variant see `canonjson/node`.
 */
export async function hash(value: unknown, options: HashOptions = {}): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new CanonJsonError("canonjson: WebCrypto (crypto.subtle) is not available in this runtime", {
      code: "webcrypto_unavailable",
      path: [],
    });
  }
  const bytes = encoder.encode(canonicalize(value, options));
  const digest = await subtle.digest(options.algorithm ?? "SHA-256", bytes);
  return encodeBytes(new Uint8Array(digest), options.encoding ?? "hex");
}

/**
 * Fast, non‑cryptographic 53‑bit hash (cyrb53) of any JSON‑compatible value,
 * returned as a 14‑character lowercase hex string. Synchronous and dependency
 * free — ideal for memoization / cache keys, React deps, request dedup.
 *
 * Do not use for security purposes.
 */
export function quickHash(value: unknown, options: CanonicalizeOptions = {}): string {
  const str = canonicalize(value, options);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** @internal shared with the node entry */
export function encodeBytes(bytes: Uint8Array, encoding: HashEncoding): string {
  switch (encoding) {
    case "hex": {
      let s = "";
      for (const b of bytes) s += HEX[b] ?? "";
      return s;
    }
    case "base64":
      return toBase64(bytes);
    case "base64url":
      return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
