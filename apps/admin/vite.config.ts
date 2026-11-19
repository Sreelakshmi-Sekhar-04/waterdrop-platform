import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The portal calls the API on its own origin (/api/...), so the sign-in cookie is first-party.
// In development and preview, Vite forwards /api to the API server.
const proxy = {
  '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
