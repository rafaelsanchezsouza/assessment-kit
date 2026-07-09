import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev proxy: the reference app (:3002) has no CORS headers — the demo talks
// to it same-origin through /api.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
