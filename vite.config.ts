import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    rollupOptions: {
      output: {
        // Split the content library (bestiary/classes/actions/equipment
        // presets) into its own cacheable chunk so app-code updates don't
        // invalidate the ~half-megabyte of game data on every release.
        manualChunks(id: string) {
          if (id.includes("/src/presets/") || id.includes("/server/assets/")) {
            return "content";
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`, the Rust `core`, and the
      //    shared `target` build directory (avoids EBUSY on Windows).
      ignored: ["**/src-tauri/**", "**/core/**", "**/target/**", "**/node_modules/**"],
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
}));
