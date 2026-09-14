import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Tauri sets TAURI_ENV_PLATFORM while it drives the dev server or a bundle build.
const tauriPlatform = process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so the same dist/ works from the Tauri asset protocol, the embedded
  // server and a plain static host alike.
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // WebView2 (Windows) and WebKitGTK are evergreen; WKWebView on older macOS is the floor.
    target: tauriPlatform === 'windows' ? 'chrome120' : ['es2022', 'safari16'],
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // The UI is loaded from the app bundle or a server on the same network, never over the
    // internet, so the shared MUI chunk being over the default 500 kB costs nothing.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        manager: resolve(import.meta.dirname, 'manager.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
