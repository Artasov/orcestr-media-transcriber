import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const frontendPort = Number(process.env.PORT || 8933);

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3933',
    },
  },
});
