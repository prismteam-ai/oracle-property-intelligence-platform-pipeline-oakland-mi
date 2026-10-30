import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "packages/**/*.test.ts",
    ],
    testTimeout: 30000,
    exclude: ["**/node_modules/**"],
  },
});
