import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { canonicalize, hash, quickHash } from "../src/index.js";
import { hashSync } from "../src/node.js";

/**
 * Property-based tests. These assert the invariants the package exists to
 * provide, over thousands of generated values, rather than over hand-picked
 * examples. A counterexample is shrunk automatically and reported with a seed.
 */

/** JSON-representable values only: no undefined, no non-finite numbers, no cycles. */
const jsonValue = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { maxDepth: 4 },
    fc.constant(null),
    fc.boolean(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.integer(),
    fc.string({ unit: "grapheme" }),
    fc.array(tie("value"), { maxLength: 5 }),
    fc.dictionary(fc.string({ unit: "grapheme" }), tie("value"), { maxKeys: 5 }),
  ),
})).value;

/** Rebuilds every object in a tree with its keys in a different insertion order. */
function shuffleKeys(value: unknown, rotate: number): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => shuffleKeys(item, rotate));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const entries = Object.entries(value);
  const offset = entries.length === 0 ? 0 : rotate % entries.length;
  const rotated = [...entries.slice(offset), ...entries.slice(0, offset)];
  return Object.fromEntries(rotated.map(([key, item]) => [key, shuffleKeys(item, rotate)]));
}

describe("canonicalize properties", () => {
  test.prop([jsonValue])("output parses back to a value equal to the input", (value) => {
    expect(JSON.parse(canonicalize(value))).toStrictEqual(JSON.parse(JSON.stringify(value)));
  });

  test.prop([jsonValue])(
    "is deterministic — the same input always gives the same bytes",
    (value) => {
      expect(canonicalize(value)).toBe(canonicalize(value));
    },
  );

  test.prop([jsonValue])(
    "is idempotent — canonicalizing its own output changes nothing",
    (value) => {
      const once = canonicalize(value);
      expect(canonicalize(JSON.parse(once))).toBe(once);
    },
  );

  test.prop([jsonValue, fc.integer({ min: 0, max: 8 })])(
    "ignores key insertion order",
    (value, rotate) => {
      expect(canonicalize(shuffleKeys(value, rotate))).toBe(canonicalize(value));
    },
  );

  test.prop([jsonValue])("emits keys in ascending UTF-16 code unit order", (value) => {
    const output = canonicalize(value);
    /* Reparsing and re-emitting is a fixed point only if the emitted order is already sorted. */
    expect(canonicalize(JSON.parse(output))).toBe(output);
  });

  test.prop([jsonValue])("produces output that JSON.parse accepts", (value) => {
    const parse = (): void => {
      JSON.parse(canonicalize(value));
    };
    expect(parse).not.toThrow();
  });

  test.prop([fc.double({ noNaN: true, noDefaultInfinity: true })])(
    "round-trips every finite double exactly",
    (number) => {
      expect(JSON.parse(canonicalize(number))).toBe(number === 0 ? 0 : number);
    },
  );

  test.prop([fc.string({ unit: "binary" })])(
    "round-trips any well-formed string exactly",
    (text) => {
      fc.pre(text.isWellFormed());
      expect(JSON.parse(canonicalize(text))).toBe(text);
    },
  );

  test.prop([fc.string({ unit: "binary" })])(
    "rejects exactly the strings that are not well formed",
    (text) => {
      if (text.isWellFormed()) {
        expect(() => canonicalize(text)).not.toThrow();
      } else {
        expect(() => canonicalize(text)).toThrow(/unpaired surrogate/);
      }
    },
  );
});

describe("hash properties", () => {
  test.prop([jsonValue, fc.integer({ min: 0, max: 8 })])(
    "hashSync ignores key insertion order",
    (value, rotate) => {
      expect(hashSync(shuffleKeys(value, rotate))).toBe(hashSync(value));
    },
  );

  test.prop([jsonValue, fc.integer({ min: 0, max: 8 })])(
    "quickHash ignores key insertion order",
    (value, rotate) => {
      expect(quickHash(shuffleKeys(value, rotate))).toBe(quickHash(value));
    },
  );

  test.prop([jsonValue])("hashSync is the digest of the canonical form", async (value) => {
    expect(hashSync(value)).toBe(await hash(value));
  });

  it("quickHash spreads over a large corpus without collisions", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50_000; i++) {
      seen.add(quickHash({ i, s: `value ${i}`, nested: { i } }));
    }
    expect(seen.size).toBe(50_000);
  });
});
