import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    restoreMocks: true,
    clearMocks: true,
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary"],
      /* A ratchet set below the measured level: it catches backsliding without failing on a
         minor dip. Raise it deliberately as coverage improves; never lower it. */
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
