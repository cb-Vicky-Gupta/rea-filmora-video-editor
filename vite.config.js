import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CSP = {
  // Desktop: everything local, media over the media:// protocol.
  desktop:
    "default-src 'self'; img-src 'self' media: data:; media-src 'self' media:; style-src 'self' 'unsafe-inline'; script-src 'self'",
  // Android: media are object URLs; ffmpeg runs as WebAssembly in a worker.
  android:
    "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; font-src 'self' data:",
};

export default defineConfig(({ mode }) => {
  const android = mode === 'android';
  // Dev mode needs inline scripts for hot reload, so the CSP only goes into production builds.
  const productionCsp = {
    name: 'production-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${android ? CSP.android : CSP.desktop}" />`,
      ),
  };
  return {
    plugins: [react(), productionCsp],
    base: './',
    server: { port: android ? 5174 : 5173, strictPort: true },
    build: { outDir: android ? 'dist-android' : 'dist', assetsInlineLimit: 0 },
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  };
});
