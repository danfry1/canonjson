// Run: pnpm build && node bench/bench.mjs
// Measures the built dist against native JSON.stringify (unsorted, no checks) as the floor.
import { canonicalize } from "../dist/index.js";

const flat = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`key${i}`, i % 3 ? `value ${i}` : i * 1.5]));
const small = {
  iss: "https://issuer.example",
  sub: "user-123",
  aud: ["a", "b"],
  exp: 1700000000,
  iat: 1699990000,
  nonce: "n-0S6_WzA2Mj",
  claims: { email: "u@x.io", verified: true },
};
const nested = {
  users: Array.from({ length: 200 }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    tags: ["a", "b", "c"],
    profile: { age: 20 + (i % 40), email: `u${i}@x.io`, active: i % 2 === 0, scores: [1.5, 2.25, 3] },
  })),
};
const strings = { text: "lorem ipsum ".repeat(500), unicode: "日本語 \u{1F600} ".repeat(200) };
const wide = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${(i * 7919) % 2000}`, i]));
let deep = 1;
for (let i = 0; i < 900; i++) deep = { d: deep, x: [i] };

const cases = { small, flat, nested, strings, wide, deep };
const libs = [
  ["JSON.stringify", JSON.stringify],
  ["canonjson", canonicalize],
];

console.log(`node ${process.version} — best of 3 rounds, ops/s (higher is better)\n`);
console.log("| payload | JSON.stringify | canonjson | relative |");
console.log("|---|---|---|---|");
for (const [name, value] of Object.entries(cases)) {
  if (JSON.parse(canonicalize(value)) === undefined) throw new Error("unreachable"); // sanity: output is valid JSON
  const iterations = ["nested", "wide", "deep"].includes(name) ? 3000 : 20000;
  const best = new Map();
  for (let round = 0; round < 3; round++) {
    for (const [lib, fn] of libs) {
      for (let i = 0; i < iterations / 4; i++) fn(value);
      const start = performance.now();
      for (let i = 0; i < iterations; i++) fn(value);
      const ops = (iterations / (performance.now() - start)) * 1000;
      best.set(lib, Math.max(best.get(lib) ?? 0, ops));
    }
  }
  const cells = libs.map(([lib]) => Math.round(best.get(lib)).toLocaleString("en-US"));
  const relative = (best.get("canonjson") / best.get("JSON.stringify")).toFixed(2);
  console.log(`| ${name} | ${cells.join(" | ")} | ${relative}× |`);
}
