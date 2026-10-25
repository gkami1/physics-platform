// @ts-check
import { unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

export default defineConfig({
  site: process.env.SITE_URL ?? 'http://localhost:4321',
  trailingSlash: 'always',
  markdown: {
    // unified rather than Astro 7's default Sätteri: remark-math + rehype-katex is the proven
    // path for LaTeX. Math is rendered to HTML at build time, so pages ship no math JavaScript.
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
      smartypants: false, // English curly quotes are wrong for Russian text
    }),
  },
  vite: {
    server: {
      // Dev only: the API runs separately (`uv run uvicorn platform_api.main:app`).
      proxy: { '/api': 'http://127.0.0.1:8000' },
    },
  },
});
