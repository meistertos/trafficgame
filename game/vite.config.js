import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// The Phaser game shares the DOM-free engine and the level pack with game-proto, so the headless
// validator (game-proto/tools/headless-validation.mjs) tests exactly the rules this game runs.
const proto = fileURLToPath(new URL('../game-proto', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@engine': `${proto}/src`,
      '@proto': proto,
    },
  },
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
