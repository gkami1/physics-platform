// Client-side Markdown + LaTeX → HTML, for content fetched at runtime (solutions, tutor
// messages). Loaded lazily: pages that never call it never download KaTeX.
//
// renderMarkdown: trusted author content from our API.
// renderUntrusted: anything a model or a user wrote — sanitized.
import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';

// $$display$$ first, then $inline$ (single line, not preceded by a backslash).
const MATH = /\$\$([\s\S]+?)\$\$|(?<!\\)\$([^$\n]+?)\$/g;
const SLOT = /@@M(\d+)@@/g;

export function renderMarkdown(source: string): string {
  const formulas: string[] = [];
  const withSlots = source.replace(MATH, (_m, display: string | undefined, inline: string | undefined) => {
    const tex = display ?? inline ?? '';
    formulas.push(
      katex.renderToString(tex.trim(), { displayMode: display !== undefined, throwOnError: false }),
    );
    return `@@M${formulas.length - 1}@@`;
  });
  const html = marked.parse(withSlots, { async: false, gfm: true });
  return html.replace(SLOT, (_m, i: string) => formulas[Number(i)] ?? '');
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

export function renderUntrusted(source: string): string {
  return DOMPurify.sanitize(renderMarkdown(source), {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
  });
}

/** While a reply streams in, hide an unfinished `$…` so half a formula never flashes. */
export function closedMathPrefix(text: string): string {
  const dollars = [...text.matchAll(/(?<!\\)\$/g)];
  return dollars.length % 2 === 1 ? text.slice(0, dollars[dollars.length - 1]!.index) : text;
}
