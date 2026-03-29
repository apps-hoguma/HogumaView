import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const tauriDevHost = process.env.TAURI_DEV_HOST;
const host = !tauriDevHost || tauriDevHost === "::1" ? "127.0.0.1" : tauriDevHost;

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1802,
    strictPort: true,
    host,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1803,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
