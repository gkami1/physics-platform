// Shared by astro.config.mjs (content collections) and src/lib/markdown.ts (task statements),
// so every piece of Markdown on the site goes through the same pipeline.
//
// unified rather than Astro 7's default Sätteri: remark-math + rehype-katex is the proven
// path for LaTeX. Math is rendered to HTML at build time, so pages ship no math JavaScript.
import { unified } from '@astrojs/markdown-remark';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

export const markdownProcessor = unified({
  remarkPlugins: [remarkMath],
  rehypePlugins: [rehypeKatex],
  smartypants: false, // English curly quotes are wrong for Russian text
});
