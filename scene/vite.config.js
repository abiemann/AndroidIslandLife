import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: '../app/src/main/assets/scene',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
});
