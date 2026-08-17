import { createHash } from "node:crypto";
import { canonicalize } from "./canonicalize.js";
import { encodeBytes, type HashAlgorithm, type HashOptions } from "./hash.js";

export * from "./index.js";

const NODE_ALGORITHM = {
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
} as const satisfies Record<HashAlgorithm, string>;

/**
 * Synchronous variant of `hash` backed by `node:crypto`.
 * Same output as the async version for the same input.
 */
export function hashSync(value: unknown, options: HashOptions = {}): string {
  const algorithm = NODE_ALGORITHM[options.algorithm ?? "SHA-256"];
  const digest = createHash(algorithm).update(canonicalize(value, options), "utf8").digest();
  return encodeBytes(
    new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength),
    options.encoding ?? "hex",
  );
}
