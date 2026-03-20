import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "pwa.svg"],
      manifest: {
        name: "Aurora Study Coach",
        short_name: "Aurora Coach",
        description: "Offline-first AI Study Coach for Rwanda",
        theme_color: "#0b1220",
        background_color: "#0b1220",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa.svg", sizes: "64x64", type: "image/svg+xml" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,json}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/packs/"),
            handler: "CacheFirst",
            options: {
              cacheName: "offline-packs",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 60 }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173
  }
});
