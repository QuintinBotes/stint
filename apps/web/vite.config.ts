import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev, /api goes to the daemon (STINT_DAEMON, default the port stint up prints).
const daemonInfo = join(import.meta.dirname, '..', '..', '.stint', 'cache', 'daemon.json');

/** The daemon puts its token in the page it serves; in dev Vite serves the page, so it reads the token the same way. */
const devToken = {
  name: 'stint-dev-token',
  apply: 'serve' as const,
  transformIndexHtml(html: string) {
    if (!existsSync(daemonInfo)) return html;
    const { token } = JSON.parse(readFileSync(daemonInfo, 'utf8')) as { token?: string };
    return token ? html.replace('</head>', `<meta name="stint-token" content="${token}" /></head>`) : html;
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), devToken],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': { target: process.env.STINT_DAEMON ?? 'http://127.0.0.1:4319', changeOrigin: false } } },
});
