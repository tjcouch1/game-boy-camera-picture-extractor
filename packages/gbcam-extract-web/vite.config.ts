import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["opencv.js"],
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm}"],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
      },
    }),
  ],
  base: "./",
});
