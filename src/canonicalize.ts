import { CanonJsonError, formatPath, type ValuePath } from "./errors.js";

/**
 * How to serialize `bigint` values. RFC 8785 only defines IEEE‑754 doubles,
 * so the default is to throw.
 *
 * - `"error"`  – throw a {@link CanonJsonError} with code `"bigint_unsupported"` (default, strict JCS)
 * - `"number"` – emit the integer digits as a JSON number literal
 *                (valid JSON, but may exceed what a double can round‑trip)
 * - `"string"` – emit the digits as a JSON string
 */
export type BigintMode = "error" | "number" | "string";

/**
 * How to treat unpaired UTF‑16 surrogates in strings and keys. RFC 8785 builds
 * on I‑JSON (RFC 7493), which requires well‑formed Unicode, so the default is
 * to throw — two canonicalizers must never disagree on the bytes for one input.
 *
 * - `"error"`  – throw a {@link CanonJsonError} with code `"lone_surrogate"` (default)
 * - `"escape"` – emit `\udXXX` escapes, as `JSON.stringify` does
 */
export type SurrogateMode = "error" | "escape";

/** Options for {@link canonicalize}. */
export type CanonicalizeOptions = {
  readonly bigint?: BigintMode;
  readonly surrogates?: SurrogateMode;
  /**
   * Maximum container nesting depth before a {@link CanonJsonError} with code
   * `"depth_exceeded"` is thrown. Bounds the work done on hostile input (e.g.
   * a payload canonicalized before signature verification). Default `1000`.
   * Values above ~2000 may exhaust the call stack instead; that is reported
   * with the same code.
   */
  readonly maxDepth?: number;
};

const DEFAULT_MAX_DEPTH = 1000;

// A short string containing none of these serializes as itself between quotes and
// cannot contain a surrogate, so one test replaces both the well‑formedness check
// and JSON.stringify. Above ~64 chars the native path is faster. Code‑unit regex (no `u`).
const NEEDS_ESCAPING = /["\\\u0000-\u001f\uD800-\uDFFF]/;
const FAST_PATH_MAX_LENGTH = 64;
// Fallback for runtimes without String.prototype.isWellFormed (ES2024): a high
// surrogate not followed by a low one, or a low surrogate not preceded by a high one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const isWellFormed: (s: string) => boolean =
  typeof String.prototype.isWellFormed === "function" ? (s) => s.isWellFormed() : (s) => !LONE_SURROGATE.test(s);

type Callable = (this: unknown, ...args: readonly unknown[]) => unknown;

function isCallable(x: unknown): x is Callable {
  return typeof x === "function";
}

/** Any non-null object can be read as `Record<string, unknown>` — that is what the type means. */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

type Ctx = {
  readonly bigint: BigintMode;
  readonly surrogates: SurrogateMode;
  readonly maxDepth: number;
  /** Containers currently being serialized, outermost first (cycle + depth detection). */
  readonly stack: object[];
  /** `cursor[i]` is the key/index inside `stack[i]` currently being serialized. */
  readonly cursor: (string | number)[];
  /** Mirror of `stack` for O(1) cycle checks; created lazily once nesting passes {@link SET_LOOKUP_DEPTH}. */
  seen: Set<object> | null;
};

// A linear scan of the stack beats Set add/delete for shallow documents; switch past this depth.
const SET_LOOKUP_DEPTH = 64;

/** Path to the value currently being serialized — computed only when building an error. */
function currentPath(ctx: Ctx): ValuePath {
  return ctx.cursor.slice(0, ctx.stack.length);
}

function fail(ctx: Ctx, code: CanonJsonError["code"], detail: string, cause?: unknown): CanonJsonError {
  const path = currentPath(ctx);
  return new CanonJsonError(`canonjson: ${detail} at ${formatPath(path)}`, {
    code,
    path,
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * Serialize any JSON‑compatible value into its RFC 8785 (JSON Canonicalization
 * Scheme) form: object keys sorted by UTF‑16 code units, no whitespace,
 * ES6 shortest‑round‑trip number formatting, and `JSON.stringify` string escaping.
 *
 * Semantics follow `JSON.stringify` for `toJSON()`, and for `undefined`,
 * functions and symbols (omitted in objects, `null` in arrays). Non‑finite
 * numbers, unpaired surrogates, cycles, excessive depth, unsupported bigints,
 * and top‑level non‑serializable values throw a {@link CanonJsonError} whose
 * `code` and `path` identify the problem.
 */
export function canonicalize(value: unknown, options: CanonicalizeOptions = {}): string {
  const ctx: Ctx = {
    bigint: options.bigint ?? "error",
    surrogates: options.surrogates ?? "error",
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    stack: [],
    cursor: [],
    seen: null,
  };
  let out: string | undefined;
  try {
    out = serialize(value, "", ctx);
  } catch (e) {
    // A stack overflow past a user-raised maxDepth is still a depth failure; report it as one.
    if (e instanceof RangeError) throw fail(ctx, "depth_exceeded", "nesting too deep (call stack exhausted)", e);
    throw e;
  }
  if (out === undefined) {
    throw new CanonJsonError(`canonjson: cannot canonicalize a top-level ${typeof value}`, {
      code: "unserializable_value",
      path: [],
    });
  }
  return out;
}

function applyToJSON(value: unknown, key: string): unknown {
  if (isRecord(value)) {
    if ("toJSON" in value && isCallable(value["toJSON"])) return value["toJSON"].call(value, key);
    return value;
  }
  if (typeof value === "bigint") {
    // JSON.stringify consults BigInt.prototype.toJSON if a polyfill defined one.
    const proto: unknown = Object.getPrototypeOf(value);
    if (isRecord(proto) && "toJSON" in proto && isCallable(proto["toJSON"])) {
      return proto["toJSON"].call(value, key);
    }
  }
  return value;
}

function serialize(raw: unknown, key: string, ctx: Ctx): string | undefined {
  const value = applyToJSON(raw, key);

  switch (typeof value) {
    case "string":
      return serializeString(value, ctx);
    case "number":
      return serializeNumber(value, ctx);
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return serializeBigint(value, ctx);
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "object":
      // null is the only non-record object; every other object reads as a record.
      return isRecord(value) ? serializeObject(value, ctx) : "null";
  }
}

function serializeString(value: string, ctx: Ctx): string {
  if (value.length <= FAST_PATH_MAX_LENGTH && !NEEDS_ESCAPING.test(value)) return `"${value}"`;
  if (ctx.surrogates === "error" && !isWellFormed(value)) {
    throw fail(
      ctx,
      "lone_surrogate",
      'string contains an unpaired surrogate and is not valid Unicode (set options.surrogates to "escape" to allow it)',
    );
  }
  return JSON.stringify(value);
}

function serializeNumber(value: number, ctx: Ctx): string {
  if (!Number.isFinite(value)) throw fail(ctx, "non_finite_number", `${String(value)} is not representable in JSON`);
  // ES6 Number::toString is exactly what JCS specifies; -0 becomes "0".
  return value === 0 ? "0" : String(value);
}

function serializeBigint(value: bigint, ctx: Ctx): string {
  switch (ctx.bigint) {
    case "number":
      return value.toString();
    case "string":
      return `"${value.toString()}"`;
    case "error":
      throw fail(
        ctx,
        "bigint_unsupported",
        'bigint is not representable in RFC 8785 JSON (set options.bigint to "number" or "string")',
      );
  }
}

/** Sort by UTF‑16 code unit order (what the default comparator does); insertion sort wins for the small key counts typical of JSON. */
function sortKeys(keys: string[]): string[] {
  if (keys.length > 32) return keys.sort();
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i];
    if (key === undefined) continue;
    let j = i;
    while (j > 0) {
      const prev = keys[j - 1];
      if (prev === undefined || !(prev > key)) break;
      keys[j] = prev;
      j--;
    }
    keys[j] = key;
  }
  return keys;
}

function serializeObject(obj: Record<string, unknown>, ctx: Ctx): string | undefined {
  // Boxed primitives behave like their primitive (JSON.stringify parity).
  if (obj instanceof Number || obj instanceof String || obj instanceof Boolean) {
    return serialize(obj.valueOf(), "", ctx);
  }

  const depth = ctx.stack.length;
  if (depth > SET_LOOKUP_DEPTH && ctx.seen === null) ctx.seen = new Set(ctx.stack);
  const seenBefore = ctx.seen === null ? ctx.stack.includes(obj) : ctx.seen.has(obj);
  if (seenBefore) throw fail(ctx, "circular_reference", "circular reference");
  if (depth >= ctx.maxDepth) throw fail(ctx, "depth_exceeded", `nesting deeper than maxDepth (${ctx.maxDepth})`);
  ctx.stack.push(obj);
  ctx.seen?.add(obj);

  let result: string;
  if (Array.isArray(obj)) {
    const items: readonly unknown[] = obj;
    let s = "[";
    for (let i = 0; i < items.length; i++) {
      if (i > 0) s += ",";
      ctx.cursor[depth] = i;
      s += serialize(items[i], String(i), ctx) ?? "null";
    }
    result = s + "]";
  } else {
    const keys = sortKeys(Object.keys(obj));
    let s = "{";
    let first = true;
    for (const k of keys) {
      ctx.cursor[depth] = k;
      const v = serialize(obj[k], k, ctx);
      if (v === undefined) continue;
      s += (first ? "" : ",") + serializeString(k, ctx) + ":" + v;
      first = false;
    }
    result = s + "}";
  }

  ctx.stack.pop();
  ctx.seen?.delete(obj);
  return result;
}
