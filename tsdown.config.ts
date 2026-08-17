import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", node: "src/node.ts", cli: "src/cli.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
  deps: { neverBundle: ["node:crypto", "node:fs"] },
});
