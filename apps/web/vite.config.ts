import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Local dev: /api → Node API. In production set VITE_API_URL instead.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
