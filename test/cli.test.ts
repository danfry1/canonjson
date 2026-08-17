import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main, parseArgs, run } from "../src/cli.js";

const dir = mkdtempSync(path.join(tmpdir(), "canonjson-"));
function file(name: string, content: string): string {
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("parseArgs", () => {
  it("defaults to canonical output from stdin", () => {
    expect(parseArgs([])).toStrictEqual({
      file: undefined,
      hash: undefined,
      encoding: "hex",
      bigint: "error",
      surrogates: "error",
      help: false,
    });
  });

  it("--hash with no value means sha256", () => {
    expect(parseArgs(["--hash"]).hash).toBe("SHA-256");
    expect(parseArgs(["--hash", "--encoding", "base64"]).hash).toBe("SHA-256");
  });

  it.each([
    { argv: ["--hash", "sha1"], expected: "SHA-1" },
    { argv: ["--hash", "sha512"], expected: "SHA-512" },
    { argv: ["--hash", "quick"], expected: "quick" },
  ])("$argv sets hash $expected", ({ argv, expected }) => {
    expect(parseArgs(argv).hash).toBe(expected);
  });

  it("accepts a single positional file", () => {
    expect(parseArgs(["in.json", "--bigint", "string"]).file).toBe("in.json");
  });

  it.each([
    {
      argv: ["--hash", "md5"],
      message: "--hash must be one of: sha1, sha256, sha384, sha512, quick",
    },
    { argv: ["--encoding", "hex2"], message: "--encoding must be one of: hex, base64, base64url" },
    { argv: ["--bigint"], message: "--bigint must be one of: error, number, string" },
    { argv: ["--surrogates", "yes"], message: "--surrogates must be one of: error, escape" },
    { argv: ["--nope"], message: "unknown option --nope" },
    { argv: ["a.json", "b.json"], message: "only one input file may be given" },
  ])("rejects $argv", ({ argv, message }) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe("run", () => {
  it("prints the canonical form of a file", () => {
    const p = file("a.json", '{ "b": [1, 2.50], "a": "x" }\n');
    expect(run([p])).toStrictEqual({ stdout: '{"a":"x","b":[1,2.5]}\n', exitCode: 0 });
  });

  it("prints a sha256 hex digest with --hash", () => {
    const p = file("b.json", '{"b":[true,null],"a":1}');
    expect(run([p, "--hash"]).stdout).toBe(
      "1cc69c7fa23616ca2ec3ee70d24390a6225c8832db8a4c814c7e0e7f942f8668\n",
    );
  });

  it("prints a quick hash with --hash quick", () => {
    const p = file("c.json", '{"userId":42,"filters":["a","b"]}');
    expect(run([p, "--hash", "quick"]).stdout).toBe("03165b44887113\n");
  });

  it("prints usage with --help", () => {
    expect(run(["--help"]).stdout).toMatch(/^Usage: canonjson/);
  });

  it("reports invalid JSON as a data error", () => {
    const p = file("bad.json", "{ nope");
    expect(() => run([p])).toThrow(/Expected|Unexpected/);
  });

  it("reports a missing file", () => {
    expect(() => run([path.join(dir, "missing.json")])).toThrow(/could not read/);
  });

  it("surfaces canonicalization failures", () => {
    const p = file("big.json", "[123456789012345678901234567890]");
    expect(run([p]).stdout).toBe("[1.2345678901234568e+29]\n");
    const q = file("nan.json", String.raw`{"s":"\ud800"}`);
    expect(() => run([q])).toThrow(/unpaired surrogate/);
    expect(run([q, "--surrogates", "escape"]).stdout).toBe('{"s":"\\ud800"}\n');
  });
});

describe("main", () => {
  function capture(argv: readonly string[]): { code: number; out: string; err: string } {
    let out = "";
    let err = "";
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    try {
      return { code: main(argv), out, err };
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  }

  it("writes the canonical form to stdout and exits 0", () => {
    const target = file("main-ok.json", '{"b":1,"a":2}');
    const result = capture([target]);
    expect(result.code).toBe(0);
    expect(result.out).toBe('{"a":2,"b":1}\n');
    expect(result.err).toBe("");
  });

  it("exits 64 with usage on an unknown option", () => {
    const result = capture(["--nope"]);
    expect(result.code).toBe(64);
    expect(result.err).toContain("unknown option --nope");
    expect(result.err).toContain("Usage: canonjson");
  });

  it("exits 66 when the input file cannot be read", () => {
    const result = capture([path.join(dir, "does-not-exist.json")]);
    expect(result.code).toBe(66);
    expect(result.err).toContain("could not read");
  });

  it("exits 65 on invalid JSON", () => {
    const target = file("main-bad.json", "{ nope");
    expect(capture([target]).code).toBe(65);
  });

  it("exits 65 when canonicalization fails", () => {
    const target = file("main-surrogate.json", String.raw`{"s":"\ud800"}`);
    const result = capture([target]);
    expect(result.code).toBe(65);
    expect(result.err).toContain("unpaired surrogate");
  });

  it("prints usage and exits 0 for --help", () => {
    const result = capture(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^Usage: canonjson/);
  });
});
