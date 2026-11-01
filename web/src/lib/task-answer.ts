// <task-answer>: checks an answer on the server, shows the verdict, attempt history and,
// when the server allows it, the reference solution. Used on task pages and in theory steps.
import { ApiError, api, type AttemptResponse, type TaskState } from './api';

const MESSAGES: Record<string, (r: AttemptResponse) => string> = {
  correct: (r) => `Верно! ${r.points} из ${r.max_points}`,
  partial: (r) => `Почти: ${r.points} из ${r.max_points} — одна ошибка`,
  wrong: () => 'Неверно. Попробуйте ещё раз',
  invalid: () => 'Не получилось распознать ответ — проверьте формат',
};

class TaskAnswer extends HTMLElement {
  private taskId = '';

  connectedCallback() {
    this.taskId = this.dataset.taskId ?? '';
    this.querySelector('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    this.q('.reveal').addEventListener('click', () => void this.reveal());
    void this.restore();
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.querySelector(sel) as T;
  }

  private async restore() {
    try {
      this.showState(await api.state(this.taskId));
    } catch {
      // Offline or API down: the form still works once it comes back.
    }
  }

  private showState(s: TaskState) {
    const graded = s.attempts.filter((a) => a.outcome !== 'revealed');
    if (graded.length > 0) {
      const h = this.q('.history');
      h.textContent = `Попыток: ${graded.length} · лучший результат: ${s.best_points} из ${s.max_points}`;
      h.hidden = false;
    }
    this.q('.reveal').hidden = !s.solution_available;
  }

  private async submit() {
    const input = this.q<HTMLInputElement>('input');
    const button = this.q<HTMLButtonElement>('form button');
    const answer = input.value.trim();
    if (!answer) return input.focus();
    button.disabled = true;
    try {
      const r = await api.submit(this.taskId, answer);
      this.verdict(MESSAGES[r.outcome]?.(r) ?? '', r.outcome);
      this.q('.reveal').hidden = !r.solution_available;
      if (r.outcome !== 'invalid') void this.restore();
    } catch (e) {
      this.verdict(this.errorText(e), 'error');
    } finally {
      button.disabled = false;
    }
  }

  private async reveal() {
    const button = this.q<HTMLButtonElement>('.reveal');
    button.disabled = true;
    try {
      const [s, { renderMarkdown }] = await Promise.all([
        api.reveal(this.taskId),
        import('./client-markdown'),
      ]);
      const final = this.q('.final');
      final.textContent = s.answer ? `Ответ: ${s.answer}` : '';
      this.q('.solution-body').innerHTML = renderMarkdown(s.solution);
      this.q('.solution').hidden = false;
      button.hidden = true;
    } catch (e) {
      this.verdict(this.errorText(e), 'error');
    } finally {
      button.disabled = false;
    }
  }

  private verdict(text: string, kind: string) {
    const v = this.q('.verdict');
    v.textContent = text;
    v.dataset.kind = kind;
    v.hidden = !text;
  }

  private errorText(e: unknown): string {
    if (e instanceof ApiError && e.status === 403) return 'Сначала попробуйте решить задачу';
    if (e instanceof ApiError && e.status === 429) return 'Слишком много попыток. Подождите минуту';
    return 'Нет связи с сервером. Попробуйте ещё раз';
  }
}

if (!customElements.get('task-answer')) customElements.define('task-answer', TaskAnswer);
