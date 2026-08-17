/** Discriminant for every failure `canonjson` can raise. */
export type CanonJsonErrorCode =
  | "non_finite_number"
  | "lone_surrogate"
  | "circular_reference"
  | "depth_exceeded"
  | "bigint_unsupported"
  | "unserializable_value"
  | "webcrypto_unavailable";

/** JSON-pointer‑ish path segments to the offending value (empty at the root). */
export type ValuePath = readonly (string | number)[];

type CanonJsonErrorContext = {
  readonly code: CanonJsonErrorCode;
  readonly path: ValuePath;
  readonly cause?: unknown;
};

/**
 * The only error type thrown by this package. Branch on `code`, and use `path`
 * to locate the offending value inside the input.
 */
export class CanonJsonError extends Error {
  public readonly code: CanonJsonErrorCode;
  public readonly path: ValuePath;

  public constructor(message: string, context: CanonJsonErrorContext) {
    super(message, context.cause === undefined ? undefined : { cause: context.cause });
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = context.code;
    this.path = context.path;
  }

  public toJSON(): {
    readonly name: string;
    readonly code: CanonJsonErrorCode;
    readonly message: string;
    readonly path: ValuePath;
  } {
    return { name: this.name, code: this.code, message: this.message, path: this.path };
  }
}

export function isCanonJsonError(e: unknown): e is CanonJsonError {
  return e instanceof CanonJsonError;
}

/** Human-readable rendering of a {@link ValuePath} for messages, e.g. `$.a[2].b`. */
export function formatPath(path: ValuePath): string {
  let s = "$";
  for (const seg of path) {
    s += typeof seg === "number" ? `[${seg}]` : `.${seg}`;
  }
  return s;
}
