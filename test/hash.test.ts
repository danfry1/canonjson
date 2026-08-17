import { afterEach, describe, expect, it, vi } from "vitest";
import { CanonJsonError, hash, quickHash } from "../src/index.js";
import { hashSync } from "../src/node.js";

// Canonicalize(INPUT) === '{"a":null,"z":[1,2,{"k":"v"}]}'
const INPUT = { z: [1, 2, { k: "v" }], a: null };

// Reference digests of that canonical string (independently computed with `openssl dgst`).
const VECTORS = [
  { algorithm: "SHA-1", encoding: "hex", expected: "bfc020a8cacfe46d5ba0b4d74c720cade467fcf9" },
  { algorithm: "SHA-1", encoding: "base64", expected: "v8AgqMrP5G1boLTXTHIMreRn/Pk=" },
  { algorithm: "SHA-1", encoding: "base64url", expected: "v8AgqMrP5G1boLTXTHIMreRn_Pk" },
  {
    algorithm: "SHA-256",
    encoding: "hex",
    expected: "ce67405388053aa59e06a8dc1b3a1232ad48ad22d002d448ec199112b586c2ac",
  },
  {
    algorithm: "SHA-256",
    encoding: "base64",
    expected: "zmdAU4gFOqWeBqjcGzoSMq1IrSLQAtRI7BmRErWGwqw=",
  },
  {
    algorithm: "SHA-256",
    encoding: "base64url",
    expected: "zmdAU4gFOqWeBqjcGzoSMq1IrSLQAtRI7BmRErWGwqw",
  },
  {
    algorithm: "SHA-384",
    encoding: "hex",
    expected:
      "e1fe445d1d67b9b205269635c15db9ad7a831c1df619aa69f8819a40933d0572db68637b6321f05ea4a4b8b48abc8d0c",
  },
  {
    algorithm: "SHA-384",
    encoding: "base64",
    expected: "4f5EXR1nubIFJpY1wV25rXqDHB32Gapp+IGaQJM9BXLbaGN7YyHwXqSkuLSKvI0M",
  },
  {
    algorithm: "SHA-384",
    encoding: "base64url",
    expected: "4f5EXR1nubIFJpY1wV25rXqDHB32Gapp-IGaQJM9BXLbaGN7YyHwXqSkuLSKvI0M",
  },
  {
    algorithm: "SHA-512",
    encoding: "hex",
    expected:
      "53f52e0f24ebc54df9b7c275c9e62f529c2e77b6281a19cec410fd6e501af98b8501a8b7075a8f2df96787a4a78023911f00a66d54541bb7caf85eb13797c177",
  },
  {
    algorithm: "SHA-512",
    encoding: "base64",
    expected:
      "U/UuDyTrxU35t8J1yeYvUpwud7YoGhnOxBD9blAa+YuFAai3B1qPLflnh6SngCORHwCmbVRUG7fK+F6xN5fBdw==",
  },
  {
    algorithm: "SHA-512",
    encoding: "base64url",
    expected:
      "U_UuDyTrxU35t8J1yeYvUpwud7YoGhnOxBD9blAa-YuFAai3B1qPLflnh6SngCORHwCmbVRUG7fK-F6xN5fBdw",
  },
] as const;

describe("hash", () => {
  it("defaults to SHA-256 hex over the canonical form", async () => {
    await expect(hash({ b: [true, null], a: 1 })).resolves.toBe(
      "1cc69c7fa23616ca2ec3ee70d24390a6225c8832db8a4c814c7e0e7f942f8668",
    );
  });

  it("produces the same digest for structurally equal values with different key order", async () => {
    const forward = await hash({ a: 1, b: [1, 2] });
    await expect(hash({ b: [1, 2], a: 1 })).resolves.toBe(forward);
  });

  it.each(VECTORS)(
    "$algorithm / $encoding matches the reference digest",
    async ({ algorithm, encoding, expected }) => {
      await expect(hash(INPUT, { algorithm, encoding })).resolves.toBe(expected);
    },
  );

  it("forwards canonicalize options (bigint)", async () => {
    await expect(hash({ n: 1n })).rejects.toThrow(CanonJsonError);
    await expect(hash({ n: 1n }, { bigint: "number" })).resolves.toBe(await hash({ n: 1 }));
  });

  describe("without WebCrypto", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("throws webcrypto_unavailable", async () => {
      vi.stubGlobal("crypto", {});
      await expect(hash({ a: 1 })).rejects.toThrow(CanonJsonError);
      await expect(hash({ a: 1 })).rejects.toThrow(/WebCrypto \(crypto\.subtle\) is not available/);
    });
  });
});

describe("hashSync (canonjson/node)", () => {
  it.each(VECTORS)(
    "$algorithm / $encoding matches the reference digest",
    ({ algorithm, encoding, expected }) => {
      expect(hashSync(INPUT, { algorithm, encoding })).toBe(expected);
    },
  );

  it("defaults to SHA-256 hex", () => {
    expect(hashSync({ b: [true, null], a: 1 })).toBe(
      "1cc69c7fa23616ca2ec3ee70d24390a6225c8832db8a4c814c7e0e7f942f8668",
    );
  });

  it("throws the same CanonJsonError as canonicalize for bad input", () => {
    expect(() => hashSync({ n: Number.NaN })).toThrow(CanonJsonError);
  });
});

describe("quickHash", () => {
  it("returns a stable 14-hex-char cyrb53 digest of the canonical form", () => {
    expect(quickHash({ userId: 42, filters: ["a", "b"] })).toBe("03165b44887113");
  });

  it("is key-order independent", () => {
    expect(quickHash({ a: 1, b: 2 })).toBe(quickHash({ b: 2, a: 1 }));
  });

  it("changes when a value changes", () => {
    expect(quickHash({ a: 1, b: 2 })).not.toBe(quickHash({ a: 1, b: 3 }));
  });

  it("hashes the empty string (canonical form is two quote characters) to a fixed digest", () => {
    expect(quickHash("")).toBe("0151798dddd9f7");
  });

  it("has no collisions across 20 000 small distinct objects", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      seen.add(quickHash({ i, s: String(i) }));
    }
    expect(seen.size).toBe(20_000);
  });
});
