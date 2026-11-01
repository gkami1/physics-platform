// Shared by astro.config.mjs (content collections) and src/lib/markdown.ts (task statements),
// so every piece of Markdown on the site goes through the same pipeline.
//
// unified rather than Astro 7's default Sätteri: remark-math + rehype-katex is the proven
// path for LaTeX. Math is rendered to HTML at build time, so pages ship no math JavaScript.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from '@astrojs/markdown-remark';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { answerControlsHtml } from './src/lib/task-answer-markup.mjs';

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

const PUBLIC_DIR = resolve(process.cwd(), process.env.PUBLIC_CONTENT_DIR ?? '../build/public');
let publicTasks; // { mtimes: string, byId: Map<string, { exam: string, task: object }> }

/** Public tasks by id, re-read when `content-build build` rewrites the bundles (dev server). */
function publicTask(id) {
  const files = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.json'));
  const mtimes = files.map((f) => statSync(resolve(PUBLIC_DIR, f)).mtimeMs).join();
  if (publicTasks?.mtimes !== mtimes) {
    const byId = new Map();
    for (const f of files) {
      const b = JSON.parse(readFileSync(resolve(PUBLIC_DIR, f), 'utf-8'));
      for (const task of b.tasks) byId.set(task.id, { exam: b.exam.id, task });
    }
    publicTasks = { mtimes, byId };
  }
  return publicTasks.byId.get(id);
}

const TASK_EMBED = /^<pp-task id="([^"]+)"><\/pp-task>$/;

/**
 * Step tasks in theory pages: a line `<pp-task id="…"></pp-task>` becomes the task's
 * statement (from build/public — never content/, which holds answers) plus the same
 * <task-answer> form as the task page. `content-build validate` checks the references.
 */
function remarkTaskEmbeds() {
  const processor = this;
  return (tree) => {
    tree.children = tree.children.flatMap((node) => {
      // `<pp-task …></pp-task>` on its own line is not a CommonMark HTML block (text follows
      // the open tag), so it arrives as a paragraph of inline html nodes.
      const raw =
        node.type === 'html'
          ? node.value
          : node.type === 'paragraph' && node.children.every((c) => c.type === 'html')
            ? node.children.map((c) => c.value).join('')
            : '';
      const m = TASK_EMBED.exec(raw.trim());
      if (!m) return [node];
      const found = publicTask(m[1]);
      if (!found) throw new Error(`Theory embeds unknown task ${m[1]}: run content-build build`);
      const { exam, task } = found;
      const statement = processor.parse(task.statement).children;
      const controls = answerControlsHtml({
        taskId: task.id,
        kind: task.answer_input.type,
        unit: task.answer_input.unit,
        headingTag: 'h3',
      });
      const href = `/${exam}/tasks/${task.id}/`;
      return [
        {
          type: 'html',
          value: '<section class="step-task"><p class="step-task-label">Попробуй сам</p><div class="step-task-statement">',
        },
        ...statement,
        {
          type: 'html',
          value:
            `</div><task-answer data-task-id="${escapeAttr(task.id)}" data-kind="${escapeAttr(task.answer_input.type)}">${controls}</task-answer>` +
            `<p class="step-task-more"><a href="${escapeAttr(href)}">Подсказки и репетитор →</a></p></section>`,
        },
      ];
    });
  };
}

const GRADE = / \((\d{1,2}(?:–\d{1,2})?) класс\)\s*$/;

/**
 * Ladder steps: `## Шаг 3. Ускорение — вектор (9 класс)` → the grade becomes a badge after
 * the heading text. `content-build validate` checks the numbering and that grades only rise.
 */
function remarkGradeBadges() {
  return (tree) => {
    for (const node of tree.children) {
      if (node.type !== 'heading' || node.depth !== 2) continue;
      const last = node.children.at(-1);
      const m = last?.type === 'text' && GRADE.exec(last.value);
      if (!m) continue;
      last.value = last.value.slice(0, m.index);
      // A real element (not raw HTML), so heading ids stay clean: «шаг-4-…-9-класс».
      node.children.push(
        { type: 'text', value: ' ' },
        {
          type: 'grade',
          data: { hName: 'span', hProperties: { className: ['grade-badge'] } },
          children: [{ type: 'text', value: `${m[1]} класс` }],
        },
      );
    }
  };
}

export const markdownProcessor = unified({
  remarkPlugins: [remarkMath, remarkInlineSvg, remarkTaskEmbeds, remarkGradeBadges],
  rehypePlugins: [rehypeKatex],
  smartypants: false, // English curly quotes are wrong for Russian text
});
