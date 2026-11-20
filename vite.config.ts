/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { lanMultiplayer } from './src/server/vitePlugin';

// `base: './'` keeps all asset URLs relative, so the build works on GitHub Pages
// under /<repo>/ as well as on a custom domain or any static host.
export default defineConfig({
  base: './',
  // lanMultiplayer: the home-network tournament server lives inside `vite preview`
  plugins: [svelte(), lanMultiplayer()],
  // reachable from other devices in the home network (phones, tablets)
  server: { host: true },
  preview: { host: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    cssMinify: true,
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
