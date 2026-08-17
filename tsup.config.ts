import { defineConfig } from "tsup";
export default defineConfig({
  entry: { index: "src/index.ts", node: "src/node.ts", cli: "src/cli.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  minify: false,
  target: "es2022",
  external: ["node:crypto", "node:fs"],
});
