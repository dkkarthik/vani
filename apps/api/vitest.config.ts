import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: process.env.VANI_INTEGRATION_TEST !== "true",
  },
});
