// @ts-check
import { defineConfig } from 'astro/config';
import { markdownProcessor } from './markdown.config.mjs';

export default defineConfig({
  site: process.env.SITE_URL ?? 'http://localhost:4321',
  // 'always' would make `astro dev` 404 /api/* before the proxy sees it. Generated links
  // all end in "/" anyway, and Caddy serves both forms in production.
  trailingSlash: 'ignore',
  // The old task list became Practice.
  redirects: { '/[exam]/tasks': '/[exam]/practice' },
  markdown: { processor: markdownProcessor },
  vite: {
    server: {
      // Dev only: the API runs separately (`uv run uvicorn platform_api.main:app`).
      // changeOrigin: false keeps the browser's Host header, which the API's CSRF Origin
      // check compares against (the string shorthand would rewrite it, like Caddy doesn't).
      proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
    },
  },
});
