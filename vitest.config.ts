import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      {
        test: {
          name: "root-contract-tests",
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
  },
});
