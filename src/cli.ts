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
  readonly code: CliErrorCode;
  constructor(code: CliErrorCode, message: string, options?: { readonly cause?: unknown }) {
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

function isKey<T extends Record<string, unknown>>(table: T, key: string): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(table, key);
}

function oneOf<const T extends readonly string[]>(flag: string, value: string | undefined, allowed: T): T[number] {
  if (value === undefined || !allowed.includes(value)) {
    throw new CliError("usage", `${flag} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): Args {
  let file: string | undefined;
  let hash: Args["hash"];
  let encoding: HashEncoding = "hex";
  let bigint: BigintMode = "error";
  let surrogates: SurrogateMode = "error";
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const next = argv[i + 1];
    switch (arg) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "--hash": {
        const value = next === undefined || next.startsWith("-") ? "sha256" : (i++, next);
        if (value === "quick") hash = "quick";
        else if (isKey(HASH_ALIASES, value)) hash = HASH_ALIASES[value];
        else throw new CliError("usage", "--hash must be one of: sha1, sha256, sha384, sha512, quick");
        break;
      }
      case "--encoding":
        encoding = oneOf(arg, next, ["hex", "base64", "base64url"]);
        i++;
        break;
      case "--bigint":
        bigint = oneOf(arg, next, ["error", "number", "string"]);
        i++;
        break;
      case "--surrogates":
        surrogates = oneOf(arg, next, ["error", "escape"]);
        i++;
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") throw new CliError("usage", `unknown option ${arg}`);
        if (file !== undefined) throw new CliError("usage", "only one input file may be given");
        file = arg;
    }
  }
  return { file, hash, encoding, bigint, surrogates, help };
}

function readInput(file: string | undefined): string {
  try {
    return readFileSync(file === undefined || file === "-" ? 0 : file, "utf8");
  } catch (e) {
    throw new CliError("read_failed", `could not read ${file ?? "stdin"}`, { cause: e });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    const detail = e instanceof SyntaxError ? e.message : "not valid JSON";
    throw new CliError("invalid_json", detail, { cause: e });
  }
}

export function run(argv: readonly string[]): { readonly stdout: string; readonly exitCode: 0 } {
  const args = parseArgs(argv);
  if (args.help) return { stdout: USAGE, exitCode: 0 };

  const value = parseJson(readInput(args.file));
  const options = { bigint: args.bigint, surrogates: args.surrogates } as const;

  try {
    if (args.hash === undefined) return { stdout: canonicalize(value, options) + "\n", exitCode: 0 };
    if (args.hash === "quick") return { stdout: quickHash(value, options) + "\n", exitCode: 0 };
    return { stdout: hashSync(value, { ...options, algorithm: args.hash, encoding: args.encoding }) + "\n", exitCode: 0 };
  } catch (e) {
    if (isCanonJsonError(e)) throw new CliError("canonicalize_failed", e.message, { cause: e });
    throw e;
  }
}

/** Single top-level handler: maps every error code to an exit code and message. */
export function main(argv: readonly string[]): number {
  try {
    const { stdout, exitCode } = run(argv);
    process.stdout.write(stdout);
    return exitCode;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    process.stderr.write(`canonjson: ${e.message}\n`);
    switch (e.code) {
      case "usage":
        process.stderr.write(`\n${USAGE}`);
        return 64; // EX_USAGE
      case "read_failed":
        return 66; // EX_NOINPUT
      case "invalid_json":
      case "canonicalize_failed":
        return 65; // EX_DATAERR
    }
  }
}
