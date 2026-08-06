import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5135, strictPort: true },
  preview: { port: 5135, strictPort: true },
  build: {
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
