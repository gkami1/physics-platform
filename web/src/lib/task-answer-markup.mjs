// Markup of the answer controls inside <task-answer>. Plain JS so both TaskAnswer.astro
// (task pages) and the remark plugin that embeds tasks into theory pages
// (markdown.config.mjs) render exactly the same form for src/lib/task-answer.ts.

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PLACEHOLDER = {
  numeric: 'Например, 12,5',
  sequence: 'Например, 13',
  measurement: 'Значение и погрешность: 2,4 0,2',
};

/**
 * @param {{ taskId: string, kind: string, unit: string | null, headingTag?: 'h2' | 'h3' }} o
 * @returns {string}
 */
export function answerControlsHtml({ taskId, kind, unit, headingTag = 'h2' }) {
  const id = `answer-${esc(taskId)}`;
  const inputMode = kind === 'sequence' ? 'numeric' : kind === 'numeric' ? 'decimal' : 'text';
  const form =
    kind === 'extended'
      ? '<p class="hint">Решите задачу на бумаге с полным обоснованием, затем сравните с эталонным решением.</p>'
      : `<form class="answer" novalidate><label for="${id}">Ответ</label><div class="row">` +
        `<input id="${id}" name="answer" autocomplete="off" autocapitalize="off" spellcheck="false" ` +
        `inputmode="${inputMode}" maxlength="64" placeholder="${esc(PLACEHOLDER[kind] ?? '')}" required>` +
        (unit ? `<span class="unit">${esc(unit)}</span>` : '') +
        '<button type="submit">Проверить</button></div></form>';
  return (
    form +
    '<p class="verdict" role="status" aria-live="polite" hidden></p>' +
    '<p class="history muted" hidden></p>' +
    `<button type="button" class="reveal"${kind === 'extended' ? '' : ' hidden'}>Показать решение</button>` +
    `<section class="solution" hidden><${headingTag}>Решение</${headingTag}>` +
    '<p class="final"></p><div class="solution-body"></div></section>'
  );
}
