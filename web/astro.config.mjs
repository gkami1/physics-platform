// @ts-check
import { defineConfig } from 'astro/config';
import { markdownProcessor } from './markdown.config.mjs';

export default defineConfig({
  site: process.env.SITE_URL ?? 'http://localhost:4321',
  // 'always' would make `astro dev` 404 /api/* before the proxy sees it. Generated links
  // all end in "/" anyway, and Caddy serves both forms in production.
  trailingSlash: 'ignore',
  markdown: { processor: markdownProcessor },
  vite: {
    server: {
      // Dev only: the API runs separately (`uv run uvicorn platform_api.main:app`).
      proxy: { '/api': 'http://127.0.0.1:8000' },
    },
  },
});
