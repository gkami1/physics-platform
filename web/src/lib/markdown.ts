// Build-time Markdown → HTML for strings that are not content-collection entries
// (task statements from build/public).
import type { MarkdownRenderer } from '@astrojs/markdown-remark';
import { markdownProcessor } from '../../markdown.config.mjs';

let renderer: Promise<MarkdownRenderer> | undefined;

export async function renderMarkdown(source: string): Promise<string> {
  renderer ??= markdownProcessor.createRenderer({});
  return (await (await renderer).render(source)).code;
}
