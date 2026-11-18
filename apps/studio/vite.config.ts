import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'chiwt-long-uploads',
      configureServer(server) {
        const relax = () => {
          const httpServer = server.httpServer;
          if (!httpServer) return;
          httpServer.requestTimeout = 0;
          httpServer.headersTimeout = 0;
          httpServer.timeout = 0;
        };
        relax();
        server.httpServer?.once('listening', relax);
      },
    },
  ],
});
