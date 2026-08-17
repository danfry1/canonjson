# canonjson

RFC 8785 ([JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)) serialization and stable hashing for any JSON-compatible value.

- **Deterministic** — same data, same bytes, regardless of key insertion order
- **Spec-exact** — passes the RFC 8785 test vectors; numbers use ES6 shortest round-trip form; keys sort by UTF-16 code units
- **Tiny** — zero dependencies, ~1 KB min+gzip, ESM + CJS, TypeScript types
- **Portable** — `hash()` uses WebCrypto, so it runs in browsers, Node ≥ 18, Deno, Bun, Cloudflare Workers, Vercel Edge

Use it for signing/verifying JSON, content-addressed storage, cache keys, request deduplication, snapshot testing, or anywhere two structurally-equal objects must produce identical output.

## Install

```sh
npm install canonjson
```

## Usage

```ts
import { canonicalize, hash, quickHash } from "canonjson";

canonicalize({ b: [1, 2], a: "x" });
// => '{"a":"x","b":[1,2]}'

canonicalize({ n: 1e30, s: "€", z: -0 });
// => '{"n":1e+30,"s":"€","z":0}'

await hash({ b: 2, a: 1 });
// => '43258cff783fe703…' (SHA-256 hex, same as hash({ a: 1, b: 2 }))

await hash(payload, { algorithm: "SHA-512", encoding: "base64url" });

quickHash({ userId: 42, filters: ["a", "b"] });
// => '03165b44887113' — sync, 53-bit, non-cryptographic; good for cache/memo keys
```

From the command line:

```sh
echo '{"z":1,"a":[1,2]}' | npx canonjson            # {"a":[1,2],"z":1}
npx canonjson payload.json --hash                    # sha256 hex
npx canonjson payload.json --hash sha512 --encoding base64url
```

Synchronous cryptographic hashing on Node:

```ts
import { hashSync } from "canonjson/node";

hashSync({ a: 1 }); // same output as `await hash({ a: 1 })`
```

## API

### `canonicalize(value, options?) → string`

Returns the RFC 8785 canonical JSON string.

Behaviour matches `JSON.stringify` wherever JCS defers to it: `toJSON()` is honoured (so `Date` works), `undefined`/functions/symbols are dropped from objects and become `null` in arrays, boxed primitives unwrap. Differences from `JSON.stringify`:

- Object keys are sorted (UTF-16 code unit order), no whitespace, ever.
- `NaN`/`Infinity` **throw** instead of becoming `null`.
- A top-level non-serializable value (e.g. `undefined`) **throws** instead of returning `undefined`.
- Circular references throw (`code: "circular_reference"`).
- `-0` serializes as `0`.

Options:

| option   | values                              | default   | notes |
| -------- | ----------------------------------- | --------- | ----- |
| `bigint` | `"error"` \| `"number"` \| `"string"` | `"error"` | JCS only defines doubles. `"number"` emits digits as a JSON number; `"string"` emits them quoted. |
| `maxDepth` | integer ≥ 0 | `1000` | Nesting limit; deeper input throws `depth_exceeded`. Bounds work on hostile payloads (e.g. before signature verification). |
| `surrogates` | `"error"` \| `"escape"` | `"error"` | RFC 8785 builds on I-JSON (RFC 7493), which requires well-formed Unicode, so unpaired UTF-16 surrogates throw. `"escape"` emits `\udXXX` like `JSON.stringify`. |

### Errors

Every failure is a `CanonJsonError` (exported) with a literal `code` and the `path` to the offending value, so callers can branch without parsing messages:

```ts
import { canonicalize, isCanonJsonError } from "canonjson";

try {
  canonicalize(payload);
} catch (e) {
  if (isCanonJsonError(e) && e.code === "circular_reference") {
    console.error("cycle at", e.path); // e.g. ["items", 3, "parent"]
  } else throw e;
}
```

| `code`                  | when |
| ----------------------- | ---- |
| `non_finite_number`     | `NaN`, `Infinity`, `-Infinity` |
| `lone_surrogate`        | a string or key with an unpaired UTF-16 surrogate (default `surrogates: "error"`) |
| `circular_reference`    | an object/array contains itself |
| `depth_exceeded`        | nesting deeper than `maxDepth` (or the call stack, if raised past ~2000) |
| `bigint_unsupported`    | a `bigint` with the default `bigint: "error"` |
| `unserializable_value`  | top-level `undefined`, function or symbol |
| `webcrypto_unavailable` | `hash()` called where `crypto.subtle` is missing |

### `hash(value, options?) → Promise<string>`

`digest(canonicalize(value))` via `crypto.subtle`. Options extend `CanonicalizeOptions` with:

| option      | values                                             | default     |
| ----------- | -------------------------------------------------- | ----------- |
| `algorithm` | `"SHA-1"` \| `"SHA-256"` \| `"SHA-384"` \| `"SHA-512"` | `"SHA-256"` |
| `encoding`  | `"hex"` \| `"base64"` \| `"base64url"`               | `"hex"`     |

### `hashSync(value, options?) → string` — from `canonjson/node`

Same as `hash` but synchronous, backed by `node:crypto`. Identical output.

### `quickHash(value, options?) → string`

Synchronous, non-cryptographic 53-bit hash (cyrb53) of the canonical form, as 14 lowercase hex chars. For memoization keys, React deps, request dedup. Not for security.

## Performance

Canonicalization has to sort keys and validate every string and number, so it costs something over plain serialization — but not much. Against native `JSON.stringify` (unsorted, unchecked) on Node 24 / Apple Silicon, best of 3 rounds (`pnpm build && node bench/bench.mjs`):

| payload | JSON.stringify | canonjson | relative |
|---|---|---|---|
| small JWT-style claims | 4.6M ops/s | 1.8M ops/s | 0.39× |
| flat 50-key object | 924k | 197k | 0.21× |
| 200 nested records | 29k | 7.7k | 0.26× |
| long strings (ASCII + CJK/emoji) | 194k | 314k | 1.62× |
| 2 000-key object | 13k | 4.2k | 0.32× |
| 900-level nesting | 4.2k | 6.4k | 1.54× |

Roughly a quarter to a third of native throughput on ordinary payloads (the sort dominates), and occasionally faster where V8's serializer takes a slow path. In practice a signing payload canonicalizes in well under a microsecond; this is never the thing you profile. Strictness — typed errors, surrogate and depth checks — is included in these numbers.
## Notes

- Only JSON data types are canonical. `Map`, `Set`, `RegExp`, class instances without `toJSON`, etc. serialize the way `JSON.stringify` would (usually `{}`), which is probably not what you want — convert them first.
- Interop: output is byte-identical to the RFC 8785 reference implementations (Java, Python, Go, .NET at [cyberphone/json-canonicalization](https://github.com/cyberphone/json-canonicalization)) for the same well-formed input.

## License

MIT
