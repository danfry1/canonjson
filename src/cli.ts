import { readFileSync } from "node:fs";
import { canonicalize, type BigintMode, type SurrogateMode } from "./canonicalize.js";
import { isCanonJsonError } from "./errors.js";
import { quickHash, type HashAlgorithm, type HashEncoding } from "./hash.js";
import { hashSync } from "./node.js";

const USAGE = `Usage: canonjson [file] [options]

Reads JSON from <file> or stdin and writes its RFC 8785 canonical form.

Options:
  --hash [ALG]        print a digest of the canonical form instead
                      ALG: sha256 (default) | sha1 | sha384 | sha512 | quick
  --encoding ENC      hex (default) | base64 | base64url
  --bigint MODE       error (default) | number | string
  --surrogates MODE   error (default) | escape
  -h, --help          show this help
`;

type CliErrorCode = "usage" | "read_failed" | "invalid_json" | "canonicalize_failed";

class CliError extends Error {
  public readonly code: CliErrorCode;
  public constructor(code: CliErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = code;
  }
}

type Args = {
  readonly file: string | undefined;
  readonly hash: HashAlgorithm | "quick" | undefined;
  readonly encoding: HashEncoding;
  readonly bigint: BigintMode;
  readonly surrogates: SurrogateMode;
  readonly help: boolean;
};

const HASH_ALIASES = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
} as const satisfies Record<string, HashAlgorithm>;

function isKey<T extends Record<string, unknown>>(
  table: T,
  key: string,
): key is Extract<keyof T, string> {
  return Object.hasOwn(table, key);
}

function oneOf<const T extends readonly string[]>(
  flag: string,
  value: string | undefined,
  allowed: T,
): T[number] {
  if (value === undefined || !allowed.includes(value)) {
    throw new CliError("usage", `${flag} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

type MutableArgs = {
  file: string | undefined;
  hash: Args["hash"];
  encoding: HashEncoding;
  bigint: BigintMode;
  surrogates: SurrogateMode;
  help: boolean;
};

function parseHashValue(raw: string): Args["hash"] {
  if (raw === "quick") {
    return "quick";
  }
  if (isKey(HASH_ALIASES, raw)) {
    return HASH_ALIASES[raw];
  }
  throw new CliError("usage", "--hash must be one of: sha1, sha256, sha384, sha512, quick");
}

function parsePositional(arg: string, state: MutableArgs): void {
  if (arg.startsWith("-") && arg !== "-") {
    throw new CliError("usage", `unknown option ${arg}`);
  }
  if (state.file !== undefined) {
    throw new CliError("usage", "only one input file may be given");
  }
  state.file = arg;
}

/** Applies one argument to `state`; returns how many argv entries it consumed. */
function applyArg(arg: string, next: string | undefined, state: MutableArgs): 1 | 2 {
  switch (arg) {
    case "-h":
    case "--help": {
      state.help = true;
      return 1;
    }
    case "--hash": {
      const omitted = next === undefined || next.startsWith("-");
      state.hash = parseHashValue(omitted ? "sha256" : next);
      return omitted ? 1 : 2;
    }
    case "--encoding": {
      state.encoding = oneOf(arg, next, ["hex", "base64", "base64url"]);
      return 2;
    }
    case "--bigint": {
      state.bigint = oneOf(arg, next, ["error", "number", "string"]);
      return 2;
    }
    case "--surrogates": {
      state.surrogates = oneOf(arg, next, ["error", "escape"]);
      return 2;
    }
    default: {
      parsePositional(arg, state);
      return 1;
    }
  }
}

export function parseArgs(argv: readonly string[]): Args {
  const state: MutableArgs = {
    file: undefined,
    hash: undefined,
    encoding: "hex",
    bigint: "error",
    surrogates: "error",
    help: false,
  };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    index += arg === undefined ? 1 : applyArg(arg, argv[index + 1], state);
  }
  return { ...state };
}

function readInput(file: string | undefined): string {
  try {
    return readFileSync(file === undefined || file === "-" ? 0 : file, "utf8");
  } catch (error) {
    throw new CliError("read_failed", `could not read ${file ?? "stdin"}`, { cause: error });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof SyntaxError ? error.message : "not valid JSON";
    throw new CliError("invalid_json", detail, { cause: error });
  }
}

export function run(argv: readonly string[]): { readonly stdout: string; readonly exitCode: 0 } {
  const args = parseArgs(argv);
  if (args.help) {
    return { stdout: USAGE, exitCode: 0 };
  }

  const value = parseJson(readInput(args.file));
  const options = { bigint: args.bigint, surrogates: args.surrogates } as const;

  try {
    if (args.hash === undefined) {
      return { stdout: `${canonicalize(value, options)}\n`, exitCode: 0 };
    }
    if (args.hash === "quick") {
      return { stdout: `${quickHash(value, options)}\n`, exitCode: 0 };
    }
    return {
      stdout: `${hashSync(value, { ...options, algorithm: args.hash, encoding: args.encoding })}\n`,
      exitCode: 0,
    };
  } catch (error) {
    if (isCanonJsonError(error)) {
      throw new CliError("canonicalize_failed", error.message, { cause: error });
    }
    throw error;
  }
}

/** Single top-level handler: maps every error code to an exit code and message. */
export function main(argv: readonly string[]): number {
  try {
    const { stdout, exitCode } = run(argv);
    process.stdout.write(stdout);
    return exitCode;
  } catch (error) {
    if (!(error instanceof CliError)) {
      throw error;
    }
    process.stderr.write(`canonjson: ${error.message}\n`);
    switch (error.code) {
      case "usage": {
        process.stderr.write(`\n${USAGE}`);
        return 64;
      } // EX_USAGE
      case "read_failed": {
        return 66;
      } // EX_NOINPUT
      case "invalid_json":
      case "canonicalize_failed": {
        return 65;
      } // EX_DATAERR
    }
  }
}
