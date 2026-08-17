# canonjson

[![CI](https://github.com/danfry1/canonjson/actions/workflows/ci.yml/badge.svg)](https://github.com/danfry1/canonjson/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/canonjson)](https://www.npmjs.com/package/canonjson)
[![bundle size](https://img.shields.io/bundlejs/size/canonjson)](https://bundlejs.com/?q=canonjson)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://github.com/danfry1/canonjson/blob/main/package.json)

**Canonical JSON and stable hashing.** The same data always produces the same bytes — and therefore the same signature, the same cache key, the same content hash.

`JSON.stringify` gives no such guarantee. Key order follows insertion order, so two objects that are equal produce different bytes:

```ts
JSON.stringify({ a: 1, b: 2 }); // '{"a":1,"b":2}'
JSON.stringify({ b: 2, a: 1 }); // '{"b":2,"a":1}'  — different signature, different cache key
```

canonjson implements [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), the JSON Canonicalization Scheme (JCS), which pins down key order, number formatting, and string escaping so that any conforming implementation — in any language — produces identical bytes.

```ts
canonicalize({ a: 1, b: 2 }); // '{"a":1,"b":2}'
canonicalize({ b: 2, a: 1 }); // '{"a":1,"b":2}'
```

- **Verified against the spec** — the six official RFC 8785 test vectors are vendored and asserted byte-for-byte, plus an idempotence check
- **Strict by default** — `NaN`, unpaired surrogates, cycles, and runaway nesting throw a typed error with the path to the offending value, rather than silently producing bytes another implementation would reject
- **Small** — zero dependencies, ~2.1 KB min+gzip, ESM + CJS, types generated from source
- **Runs anywhere** — Node ≥ 20, Bun, Deno, browsers, Cloudflare Workers, Vercel Edge
- **Hashing included** — `hash()` (WebCrypto), `hashSync()` (Node), `quickHash()` (fast, non-cryptographic)

## Install

```sh
npm  install canonjson
pnpm add     canonjson
yarn add     canonjson
bun  add     canonjson
```

Deno: `import { canonicalize } from "npm:canonjson";`

## Usage

```ts
import { canonicalize, hash, quickHash } from "canonjson";

canonicalize({ b: [1, 2], a: "x" });
// => '{"a":"x","b":[1,2]}'

canonicalize({ n: 1e30, s: "€", z: -0 });
// => '{"n":1e+30,"s":"€","z":0}'

await hash({ b: 2, a: 1 });
// => '43258cff783fe703…'  (SHA-256 hex; identical for { a: 1, b: 2 })

await hash(payload, { algorithm: "SHA-512", encoding: "base64url" });

quickHash({ userId: 42, filters: ["a", "b"] });
// => '03165b44887113'  — sync, non-cryptographic; for cache and memo keys
```

Synchronous cryptographic hashing on Node:

```ts
import { hashSync } from "canonjson/node";

hashSync({ a: 1 }); // identical output to `await hash({ a: 1 })`
```

### Signing a payload

The reason canonicalization exists: the verifier must reconstruct the exact bytes the signer signed, from data that may have been reserialized, reordered, or round-tripped through another language in between.

```ts
import { canonicalize } from "canonjson";

const encoder = new TextEncoder();

async function sign(payload: unknown, key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.sign("HMAC", key, encoder.encode(canonicalize(payload)));
}

async function verify(payload: unknown, signature: ArrayBuffer, key: CryptoKey): Promise<boolean> {
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(canonicalize(payload)));
}

const claims = { sub: "user-1", scopes: ["read", "write"], exp: 1_800_000_000 };
const signature = await sign(claims, key);

// Reordered, reparsed, or rebuilt elsewhere — still verifies.
await verify({ exp: 1_800_000_000, scopes: ["read", "write"], sub: "user-1" }, signature, key); // true
```

### Cache and deduplication keys

```ts
import { quickHash } from "canonjson";

const cache = new Map<string, Promise<Result>>();

function query(params: QueryParams): Promise<Result> {
  const key = quickHash(params); // stable regardless of how params was built
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const pending = fetchResult(params);
  cache.set(key, pending);
  return pending;
}
```

## CLI

```sh
echo '{"z":1,"a":[1,2]}' | npx canonjson         # {"a":[1,2],"z":1}
npx canonjson payload.json --hash                # SHA-256 hex of the canonical form
npx canonjson payload.json --hash sha512 --encoding base64url
```

```
Usage: canonjson [file] [options]

Reads JSON from <file> or stdin and writes its RFC 8785 canonical form.

Options:
  --hash [ALG]        print a digest of the canonical form instead
                      ALG: sha256 (default) | sha1 | sha384 | sha512 | quick
  --encoding ENC      hex (default) | base64 | base64url
  --bigint MODE       error (default) | number | string
  --surrogates MODE   error (default) | escape
  -h, --help          show this help
```

Exit codes follow sysexits: `64` usage, `65` bad data, `66` unreadable input.

## API

### `canonicalize(value, options?) → string`

Returns the RFC 8785 canonical JSON string.

Behaviour matches `JSON.stringify` wherever JCS defers to it: `toJSON()` is honoured (so `Date` works), `undefined`/functions/symbols are dropped from objects and become `null` in arrays, boxed primitives unwrap. It differs where the spec requires it to:

|                       | `JSON.stringify`    | `canonicalize`                             |
| --------------------- | ------------------- | ------------------------------------------ |
| object key order      | insertion           | sorted by UTF-16 code unit                 |
| whitespace            | configurable        | never                                      |
| `NaN` / `Infinity`    | `null`              | throws `non_finite_number`                 |
| unpaired surrogate    | `"\udXXX"`          | throws `lone_surrogate`                    |
| circular reference    | throws `TypeError`  | throws `circular_reference`, with the path |
| deep nesting          | stack overflow      | throws `depth_exceeded` at `maxDepth`      |
| top-level `undefined` | returns `undefined` | throws `unserializable_value`              |
| `-0`                  | `0`                 | `0`                                        |

Options:

| option       | values                                | default   | notes                                                                                                                                                                |
| ------------ | ------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bigint`     | `"error"` \| `"number"` \| `"string"` | `"error"` | JCS only defines IEEE-754 doubles. `"number"` emits the digits as a JSON number; `"string"` emits them quoted.                                                       |
| `surrogates` | `"error"` \| `"escape"`               | `"error"` | RFC 8785 builds on I-JSON ([RFC 7493](https://www.rfc-editor.org/rfc/rfc7493)), which requires well-formed Unicode. `"escape"` emits `\udXXX` like `JSON.stringify`. |
| `maxDepth`   | integer ≥ 0                           | `1000`    | Nesting limit. Bounds work on hostile input — a payload is often canonicalized _before_ its signature is checked.                                                    |

### `hash(value, options?) → Promise<string>`

`digest(canonicalize(value))` via `crypto.subtle`. Options extend `CanonicalizeOptions` with:

| option      | values                                                 | default     |
| ----------- | ------------------------------------------------------ | ----------- |
| `algorithm` | `"SHA-1"` \| `"SHA-256"` \| `"SHA-384"` \| `"SHA-512"` | `"SHA-256"` |
| `encoding`  | `"hex"` \| `"base64"` \| `"base64url"`                 | `"hex"`     |

### `hashSync(value, options?) → string` — from `canonjson/node`

Synchronous equivalent backed by `node:crypto`. Byte-identical output.

### `quickHash(value, options?) → string`

Synchronous, non-cryptographic 53-bit hash (cyrb53) of the canonical form, as 14 lowercase hex characters. For memoization keys, effect dependencies, and request deduplication. **Not for security** — it is not collision-resistant against an adversary.

### Errors

Every failure is a `CanonJsonError` with a literal `code` and the `path` to the offending value, so callers branch on a discriminant instead of parsing messages:

```ts
import { canonicalize, isCanonJsonError } from "canonjson";

try {
  canonicalize(payload);
} catch (error) {
  if (isCanonJsonError(error) && error.code === "circular_reference") {
    console.error("cycle at", error.path); // e.g. ["items", 3, "parent"]
  } else {
    throw error;
  }
}
```

| `code`                  | when                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `non_finite_number`     | `NaN`, `Infinity`, `-Infinity`                                                       |
| `lone_surrogate`        | a string or key with an unpaired UTF-16 surrogate (default `surrogates: "error"`)    |
| `circular_reference`    | an object or array contains itself                                                   |
| `depth_exceeded`        | nesting deeper than `maxDepth`, or the call stack if `maxDepth` is raised past ~2000 |
| `bigint_unsupported`    | a `bigint` under the default `bigint: "error"`                                       |
| `unserializable_value`  | top-level `undefined`, function, or symbol                                           |
| `webcrypto_unavailable` | `hash()` called where `crypto.subtle` is missing                                     |

`error.toJSON()` emits `{ name, code, message, path }`, so errors survive structured logging.

## Conformance

The [official RFC 8785 test vectors](https://github.com/cyberphone/json-canonicalization/tree/master/testdata) — `arrays`, `french`, `structures`, `unicode`, `values`, `weird` — are vendored in [`test/vectors/`](test/vectors) and asserted byte-for-byte against the reference output, in both directions (canonicalizing the reference output must reproduce it). Output is therefore byte-identical to the Java, Python, Go, and .NET reference implementations for the same well-formed input.

Number formatting uses ES6 `Number::toString`, which is what §3.2.2.3 specifies; `1e30` serializes as `1e+30`, `4.50` as `4.5`, and `333333333.33333329` as `333333333.3333333`.

## Notes and limits

- **Only JSON data types are canonical.** `Map`, `Set`, `RegExp`, and class instances without `toJSON` serialize the way `JSON.stringify` would — usually `{}`. Convert them before canonicalizing.
- **Numbers are doubles.** An integer beyond `Number.MAX_SAFE_INTEGER` has already lost precision by the time it reaches this library; carry it as a string or a `bigint` with `bigint: "string"`.
- **Canonicalization is not validation.** It normalizes bytes; it does not check that the payload is the shape you expected. Parse with a schema at the boundary.
- **`quickHash` is not a security primitive**, and `hash` is a plain digest, not an HMAC — pass a key to `crypto.subtle` yourself for authentication.

## Performance

Canonicalization sorts keys and validates every string and number, so it costs something over plain serialization — but not much. Against native `JSON.stringify` (unsorted, unchecked) on Node 24 / Apple Silicon, best of 3 rounds (`bun run bench`):

| payload                          | JSON.stringify | canonjson  | relative |
| -------------------------------- | -------------- | ---------- | -------- |
| small JWT-style claims           | 4.6M ops/s     | 1.8M ops/s | 0.39×    |
| flat 50-key object               | 924k           | 197k       | 0.21×    |
| 200 nested records               | 29k            | 7.7k       | 0.26×    |
| long strings (ASCII + CJK/emoji) | 194k           | 314k       | 1.62×    |
| 2 000-key object                 | 13k            | 4.2k       | 0.32×    |
| 900-level nesting                | 4.2k           | 6.4k       | 1.54×    |

A quarter to a third of native throughput on ordinary payloads — the sort dominates — and faster where V8's serializer takes a slow path. A signing payload canonicalizes in well under a microsecond. Strictness is included in these numbers.

## Contributing

```sh
bun install
bun run check   # format, lint, types, tests, build
```

## License

MIT
