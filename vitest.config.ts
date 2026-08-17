import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { restoreMocks: true, clearMocks: true, sequence: { shuffle: true } },
});
