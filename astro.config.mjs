import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://rainpot.github.io",
  base: process.env.BASE_PATH ?? "/",
  output: "static",
  integrations: [react()],
  vite: {
    optimizeDeps: {
      include: ["react", "react-dom/client"]
    }
  }
});
