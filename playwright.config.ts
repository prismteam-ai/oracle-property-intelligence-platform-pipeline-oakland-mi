import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";
const buildId = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      args: [
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    },
  },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.PRISM_BROWSER_REPORT_PATH ??
          "test-results/oracle-browser.json",
      },
    ],
  ],
  webServer: [
    {
      command: "pnpm api",
      url: "http://127.0.0.1:4310/api/health",
      reuseExistingServer: !process.env.CI,
      env: {
        PRISM_DATA_MODE: process.env.PRISM_TEST_MODE ?? "synthetic",
        PRISM_ACCESS_MODE: "local",
        PRISM_BUILD_ID: buildId,
        PRISM_OWNER_DERIVATIVES: "",
        PRISM_PRIVATE_ENRICHMENT: "",
        PRISM_PRIVATE_PERMITS: "",
        PRISM_PRIVATE_SOURCE_INTAKE: "",
        PRISM_PRIVATE_FULL_SOURCES: "[]",
        PRISM_PRIVATE_PROVIDER_OBSERVATIONS: "",
        PRISM_PRIVATE_TRANSFER_OBSERVATIONS: "",
        PRISM_PRIVATE_SOURCE_RUNS: "",
        PRISM_OFFICIAL_PARCEL_PROFILE: "",
        PRISM_OFFICIAL_PARCEL_PROFILE_SHA256: "",
        PRISM_SNAPSHOT_DIR: process.env.PRISM_SNAPSHOT_DIR ?? "",
      },
    },
    {
      command: "pnpm dev",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
