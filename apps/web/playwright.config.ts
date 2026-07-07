import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3105",
    channel: "chrome", // use the installed Chrome — no browser download
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npm run dev -- --port 3105",
    url: "http://localhost:3105",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
