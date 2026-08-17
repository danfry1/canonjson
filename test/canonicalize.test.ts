import { describe, expect, it } from "vitest";
import { CanonJsonError, canonicalize, formatPath, isCanonJsonError } from "../src/index.js";

describe("canonicalize — RFC 8785 conformance", () => {
  it("reproduces the Appendix B example byte-for-byte", () => {
    const input: unknown = JSON.parse(
      `{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],${String.raw`"string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",`}"literals": [null, true, false]}`,
    );
    expect(canonicalize(input)).toBe(
      String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`,
    );
  });

  it("sorts keys by UTF-16 code units, not code points or locale (§3.2.3)", () => {
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    };
    expect(canonicalize(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis",' +
        '"€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it.each([
    { n: 0, expected: "0" },
    { n: -0, expected: "0" },
    { n: 1, expected: "1" },
    { n: -1, expected: "-1" },
    { n: 0.1, expected: "0.1" },
    { n: 1e21, expected: "1e+21" },
    { n: 1e-7, expected: "1e-7" },
    { n: 5e-324, expected: "5e-324" },
    { n: 1.7976931348623157e308, expected: "1.7976931348623157e+308" },
    { n: 999_999_999_999_999_900_000, expected: "999999999999999900000" },
    { n: 1e22, expected: "1e+22" },
    { n: 333_333_333.33333329, expected: "333333333.3333333" },
  ])("formats $n as $expected (ES6 Number::toString)", ({ n, expected }) => {
    expect(canonicalize(n)).toBe(expected);
  });

  it.each([
    { value: Number.NaN, label: "NaN" },
    { value: Infinity, label: "Infinity" },
    { value: -Infinity, label: "-Infinity" },
  ])("throws non_finite_number for $label", ({ value }) => {
    expect(() => canonicalize(value)).toThrow(CanonJsonError);
    expect(() => canonicalize(value)).toThrow(/is not representable in JSON/);
  });
});

describe("canonicalize — JSON.stringify parity", () => {
  it("emits nested objects and arrays with sorted keys and no whitespace", () => {
    expect(canonicalize({ b: [1, { z: 1, a: 2 }], a: "x" })).toBe(
      '{"a":"x","b":[1,{"a":2,"z":1}]}',
    );
  });

  it("omits undefined, functions and symbols from objects", () => {
    expect(canonicalize({ a: undefined, b: () => 1, c: Symbol("s"), d: 1 })).toBe('{"d":1}');
  });

  it("serializes undefined, functions and symbols in arrays as null", () => {
    expect(canonicalize([undefined, () => 1, Symbol("s"), 1])).toBe("[null,null,null,1]");
  });

  it.each([
    { value: undefined, label: "undefined" },
    { value: () => 1, label: "a function" },
    { value: Symbol("x"), label: "a symbol" },
  ])("throws unserializable_value for a top-level $label", ({ value }) => {
    expect(() => canonicalize(value)).toThrow(CanonJsonError);
    expect(() => canonicalize(value)).toThrow(/cannot canonicalize a top-level/);
  });

  it("calls toJSON with the property key, like JSON.stringify", () => {
    expect(canonicalize({ x: { toJSON: (k: string) => `key=${k}` } })).toBe('{"x":"key=x"}');
  });

  it("serializes Date via toJSON as an ISO string", () => {
    const date = new Date(Date.UTC(2020, 0, 1));
    expect(canonicalize({ d: date })).toBe('{"d":"2020-01-01T00:00:00.000Z"}');
  });

  it("unwraps boxed primitives", () => {
    expect(canonicalize([1, "s", false])).toBe('[1,"s",false]');
  });

  it(
    String.raw`escapes control characters with lowercase \u00xx and short escapes where defined`,
    () => {
      expect(canonicalize('"\\/\b\f\n\r\t')).toBe(String.raw`"\u0001\u001f\"\\/\b\f\n\r\t"`);
    },
  );

  it("passes well-formed surrogate pairs through unchanged", () => {
    expect(canonicalize("\uD83D\uDE00")).toBe('"\uD83D\uDE00"');
  });

  it("throws circular_reference with the path to the cycle in an object", () => {
    const a: Record<string, unknown> = {};
    a["self"] = { inner: a };
    expect(() => canonicalize(a)).toThrow(CanonJsonError);
    expect(() => canonicalize(a)).toThrow("canonjson: circular reference at $.self.inner");
  });

  it("throws circular_reference with the path to the cycle in an array", () => {
    const arr: unknown[] = [0];
    arr.push(arr);
    expect(() => canonicalize(arr)).toThrow("canonjson: circular reference at $[1]");
  });

  it("detects a cycle that closes deeper than the Set-lookup threshold", () => {
    const root: Record<string, unknown> = {};
    let cur = root;
    for (let i = 0; i < 100; i++) {
      const next: Record<string, unknown> = {};
      cur["n"] = next;
      cur = next;
    }
    cur["back"] = root;
    expect(() => canonicalize(root)).toThrow(CanonJsonError);
    expect(() => canonicalize(root)).toThrow(`circular reference at $${".n".repeat(100)}.back`);
  });

  it("allows repeated references to a shared object deeper than the Set-lookup threshold", () => {
    const shared = { x: 1 };
    let v: unknown = { a: shared, b: shared };
    for (let i = 0; i < 100; i++) {
      v = { c: v, d: shared };
    }
    expect(
      canonicalize(v).endsWith(`{"a":{"x":1},"b":{"x":1}}${',"d":{"x":1}}'.repeat(100)}`),
    ).toBe(true);
  });

  it("allows the same object referenced twice when there is no cycle", () => {
    const shared = { x: 1 };
    expect(canonicalize({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it("ignores inherited (non-own) properties", () => {
    const obj: Record<string, unknown> = Object.create({ inherited: 1 });
    obj["own"] = 2;
    expect(canonicalize(obj)).toBe('{"own":2}');
  });

  it("serializes an empty object and empty array", () => {
    expect(canonicalize({})).toBe("{}");
    expect(canonicalize([])).toBe("[]");
  });
});

describe("canonicalize — surrogates option", () => {
  it.each([
    { input: "\uD800", label: "lone high surrogate" },
    { input: "a\uDC00b", label: "lone low surrogate" },
    { input: "\uD800\uD800", label: "two high surrogates" },
    { input: "\uDC00\uD800", label: "reversed pair" },
  ])("throws lone_surrogate for $label by default", ({ input }) => {
    expect(() => canonicalize({ s: input })).toThrow(CanonJsonError);
    expect(() => canonicalize({ s: input })).toThrow(/contains an unpaired surrogate .* at \$\.s$/);
  });

  it("checks object keys as well as values", () => {
    expect(() => canonicalize({ "\uD800": 1 })).toThrow(
      /contains an unpaired surrogate .* at \$\.\uD800$/,
    );
  });

  it('escapes unpaired surrogates like JSON.stringify with surrogates: "escape"', () => {
    expect(canonicalize("\uD800", { surrogates: "escape" })).toBe(String.raw`"\ud800"`);
    expect(canonicalize({ "\uDC00": "\uD800" }, { surrogates: "escape" })).toBe(
      String.raw`{"\udc00":"\ud800"}`,
    );
  });
});

describe("canonicalize — maxDepth option", () => {
  function nest(depth: number): unknown {
    let v: unknown = 1;
    for (let i = 0; i < depth; i++) {
      v = [v];
    }
    return v;
  }

  it("allows nesting up to the default of 1000 containers", () => {
    expect(canonicalize(nest(1000))).toBe(`${"[".repeat(1000)}1${"]".repeat(1000)}`);
  });

  it("throws depth_exceeded at 1001 containers by default, naming the path", () => {
    expect(() => canonicalize(nest(1001))).toThrow(CanonJsonError);
    expect(() => canonicalize(nest(1001))).toThrow(
      `canonjson: nesting deeper than maxDepth (1000) at $${"[0]".repeat(1000)}`,
    );
  });

  it("honours a lower maxDepth", () => {
    expect(() => canonicalize({ a: { b: 1 } }, { maxDepth: 1 })).toThrow(
      /nesting deeper than maxDepth \(1\) at \$\.a/,
    );
    expect(canonicalize({ a: 1 }, { maxDepth: 1 })).toBe('{"a":1}');
  });

  it("reports a genuine stack overflow as depth_exceeded when maxDepth is raised beyond the runtime limit", () => {
    expect.assertions(2);
    try {
      canonicalize(nest(100_000), { maxDepth: Infinity });
    } catch (error) {
      expect(isCanonJsonError(error)).toBe(true);
      if (isCanonJsonError(error)) {
        expect(error.code).toBe("depth_exceeded");
      }
    }
  });
});

describe("canonicalize — bigint option", () => {
  it("throws bigint_unsupported by default, naming the path", () => {
    expect(() => canonicalize({ n: [1n] })).toThrow(CanonJsonError);
    expect(() => canonicalize({ n: [1n] })).toThrow(
      /bigint is not representable .* at \$\.n\[0\]$/,
    );
  });

  it('emits digits as a JSON number with bigint: "number"', () => {
    expect(
      canonicalize({ n: 123_456_789_012_345_678_901_234_567_890n }, { bigint: "number" }),
    ).toBe('{"n":123456789012345678901234567890}');
  });

  it('emits digits as a JSON string with bigint: "string"', () => {
    expect(canonicalize([-5n], { bigint: "string" })).toBe('["-5"]');
  });
});

describe("CanonJsonError", () => {
  it("carries a code, a path, and a name, and is detected by isCanonJsonError", () => {
    expect.assertions(5);
    try {
      canonicalize({ a: [1, { b: Number.NaN }] });
    } catch (error) {
      expect(isCanonJsonError(error)).toBe(true);
      expect(error).toBeInstanceOf(CanonJsonError);
      if (!isCanonJsonError(error)) {
        return;
      }
      expect(error.code).toBe("non_finite_number");
      expect(error.path).toStrictEqual(["a", 1, "b"]);
      expect(error.name).toBe("CanonJsonError");
    }
  });

  it("serializes to JSON with code, message and path", () => {
    const err = new CanonJsonError("msg", { code: "circular_reference", path: ["x", 0] });
    expect(JSON.parse(JSON.stringify(err))).toStrictEqual({
      name: "CanonJsonError",
      code: "circular_reference",
      message: "msg",
      path: ["x", 0],
    });
  });

  it("isCanonJsonError rejects plain errors and non-errors", () => {
    expect(isCanonJsonError(new Error("x"))).toBe(false);
    expect(isCanonJsonError("nope")).toBe(false);
  });
});

describe("formatPath", () => {
  it.each([
    { path: [], expected: "$" },
    { path: ["a"], expected: "$.a" },
    { path: ["a", 2, "b"], expected: "$.a[2].b" },
    { path: [0], expected: "$[0]" },
  ])("renders $path as $expected", ({ path, expected }) => {
    expect(formatPath(path)).toBe(expected);
  });
});
