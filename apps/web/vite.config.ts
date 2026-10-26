import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev, /api goes to the daemon (STINT_DAEMON, default the port stint up prints).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': { target: process.env.STINT_DAEMON ?? 'http://127.0.0.1:4319', changeOrigin: false } } },
});
