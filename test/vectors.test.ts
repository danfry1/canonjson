import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/index.js";

// The official RFC 8785 test vectors, vendored verbatim from the reference
// Implementation repository: cyberphone/json-canonicalization, testdata/.
// Passing these is what "byte-identical to the reference implementations" means.
const VECTORS = path.join(import.meta.dirname, "vectors");
const names = readdirSync(path.join(VECTORS, "input")).sort();

describe("RFC 8785 official test vectors", () => {
  it("vendors all six vector files", () => {
    expect(names).toStrictEqual([
      "arrays.json",
      "french.json",
      "structures.json",
      "unicode.json",
      "values.json",
      "weird.json",
    ]);
  });

  it.each(names)("%s canonicalizes to the reference output byte-for-byte", (name) => {
    const input: unknown = JSON.parse(readFileSync(path.join(VECTORS, "input", name), "utf8"));
    const expected = readFileSync(path.join(VECTORS, "output", name), "utf8");
    expect(canonicalize(input)).toBe(expected);
  });

  it.each(names)("%s is idempotent — canonicalizing the output reproduces it", (name) => {
    const expected = readFileSync(path.join(VECTORS, "output", name), "utf8");
    const reparsed: unknown = JSON.parse(expected);
    expect(canonicalize(reparsed)).toBe(expected);
  });
});
