// Shared by astro.config.mjs (content collections) and src/lib/markdown.ts (task statements),
// so every piece of Markdown on the site goes through the same pipeline.
//
// unified rather than Astro 7's default Sätteri: remark-math + rehype-katex is the proven
// path for LaTeX. Math is rendered to HTML at build time, so pages ship no math JavaScript.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from '@astrojs/markdown-remark';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

const escapeAttr = (s) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Inline local SVG figures: a paragraph holding only `![alt](path.svg)` becomes
 * `<figure class="fig" role="img" aria-label="alt"><svg …></figure>`. An <img> cannot follow
 * the light/dark theme; inline SVG drawn with currentColor and fig-* classes can.
 * Mirrors content_schema.figures.inline_svg_images, which does the same for task statements
 * (those arrive here already inlined). Theory pages are read from content/ by Astro directly.
 */
function remarkInlineSvg() {
  return (tree, file) => {
    const raw = file.path ?? file.history?.[0];
    if (!raw) return;
    const base = dirname(raw.startsWith('file:') ? fileURLToPath(raw) : raw);
    tree.children = tree.children.map((node) => {
      if (node.type !== 'paragraph' || node.children.length !== 1) return node;
      const img = node.children[0];
      if (img.type !== 'image' || !/^[^:]+\.svg$/.test(img.url)) return node;
      let svg;
      try {
        svg = readFileSync(resolve(base, img.url), 'utf-8');
      } catch {
        return node; // content-build validate reports missing images
      }
      svg = svg.replace(/<\?xml[^>]*\?>/g, '').replace(/\s*\n\s*/g, ' ').trim();
      const alt = escapeAttr(img.alt ?? '');
      return { type: 'html', value: `<figure class="fig" role="img" aria-label="${alt}">${svg}</figure>` };
    });
  };
}

export const markdownProcessor = unified({
  remarkPlugins: [remarkMath, remarkInlineSvg],
  rehypePlugins: [rehypeKatex],
  smartypants: false, // English curly quotes are wrong for Russian text
});
