// Client-side Markdown + LaTeX → HTML, for content fetched at runtime (solutions now,
// tutor messages in M4). Loaded lazily: pages that never call it never download KaTeX.
//
// Not sanitized: today it only renders author-written content from our own API.
// Before rendering LLM output (M4) add a sanitizer — that text is untrusted.
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
