/**
 * «Мой профиль»: the shape of `GET /api/insights` (api/src/platform_api/insights.py) and the
 * rule-based «что думает репетитор» text built from its numbers. No LLM, no Astro imports:
 * `npm test` runs this file's tests under plain Node.
 */

export type TopicStatus =
  'weak' | 'shaky' | 'review_due' | 'in_progress' | 'strong' | 'not_started';

/** Display order of the status groups (the API's `counts` keys, worst first). */
export const STATUS_ORDER: TopicStatus[] = [
  'weak',
  'shaky',
  'review_due',
  'in_progress',
  'strong',
  'not_started',
];

export interface TopicReasons {
  mastery: number | null;
  graded_tasks: number;
  first_try_accuracy: number | null;
  solved_tasks: number;
  attempts_per_solved: number | null;
  heavy_help_share: number | null;
  reveals: number;
  theory_questions: number;
  task_questions: number;
  lessons: { total: number; opened: number; finished: number };
  reading_minutes: number;
  /** UTC date, YYYY-MM-DD. */
  last_practised: string | null;
}

export interface TopicInsight {
  topic_id: string;
  status: TopicStatus;
  reasons: TopicReasons;
}

export interface PracticeItem {
  task_id: string;
  topic_id: string;
  ege_task: number | null;
  reason: TopicStatus;
  done: boolean;
}

export interface Mistake {
  task_id: string;
  ege_task: number | null;
  topic_ids: string[];
  mistake_on: string;
  due_on: string;
  due: boolean;
}

export interface ScoreRange {
  low: number;
  expected: number;
  high: number;
}

export interface NumberPrediction {
  number: number;
  part: number;
  max_points: number;
  expected: number | null;
  basis: 'mastery' | 'variants' | 'blend' | 'none';
  mastery_tasks: number;
  variant_runs: number;
}

export interface Prediction {
  enough_data: boolean;
  max_primary: number;
  primary: ScoreRange | null;
  test: ScoreRange | null;
  scale_season: number | null;
  per_number: NumberPrediction[];
  missing_numbers: number[];
  graded_tasks_needed: number;
}

export interface Insights {
  exam_id: string;
  /** Free tier while the profile is premium: only `counts` and one topic are filled. */
  teaser: boolean;
  as_of: string;
  counts: Record<TopicStatus | 'practice' | 'mistakes' | 'mistakes_due', number>;
  topics: TopicInsight[];
  practice: PracticeItem[] | null;
  mistakes: Mistake[] | null;
  prediction: Prediction | null;
}

// --- Russian text -------------------------------------------------------------------------

/** plural(5, ['задача', 'задачи', 'задач']) → 'задач'. */
export function plural(n: number, forms: [string, string, string]): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return forms[0];
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return forms[1];
  return forms[2];
}

export const count = (n: number, forms: [string, string, string]): string =>
  `${n} ${plural(n, forms)}`;

export const pct = (x: number): string => `${Math.round(x * 100)} %`;

/** 2.25 → «2,3». */
export const decimal = (x: number): string => x.toFixed(1).replace('.', ',');

/** Whole days between two UTC dates (YYYY-MM-DD or ISO). */
export function daysBetween(from: string, to: string): number {
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((day(to) - day(from)) / 86_400_000);
}

export function ago(days: number): string {
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${count(days, ['день', 'дня', 'дней'])} назад`;
}

const TASKS: [string, string, string] = ['задача', 'задачи', 'задач'];
const TASKS_ACC: [string, string, string] = ['задачу', 'задачи', 'задач'];
const TASKS_GEN: [string, string, string] = ['задачи', 'задач', 'задач']; // «из 4 задач»
const LESSONS_GEN: [string, string, string] = ['урока', 'уроков', 'уроков'];

function list(titles: string[], max = 2): string {
  const shown = titles.slice(0, max).map((t) => `«${t}»`);
  const rest = titles.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} и ещё ${rest}`;
  if (shown.length === 2) return `${shown[0]} и ${shown[1]}`;
  return shown.join('');
}

/** What to do about a weak or shaky topic, from its reading and tutor numbers. */
function advice(r: TopicReasons): string {
  const { total, finished } = r.lessons;
  if (total > 0 && finished < total) {
    return finished === 0
      ? 'Начните с теории: уроки по ней ещё не дочитаны.'
      : `Теория дочитана на ${finished} из ${count(total, LESSONS_GEN)} — стоит закончить.`;
  }
  if (r.theory_questions + r.task_questions === 0) {
    return 'Попробуйте разобрать одну задачу вместе с репетитором.';
  }
  return 'Решите ещё несколько задач из тренировки ниже.';
}

/**
 * «Что думает репетитор»: 2–4 sentences, most urgent first. Every number comes from the
 * API's reasons, so the text can't disagree with the cards below it.
 */
export function tutorSummary(data: Insights, titles: Record<string, string>): string[] {
  const title = (id: string) => titles[id] ?? id;
  const of = (s: TopicStatus) => data.topics.filter((t) => t.status === s);
  const out: string[] = [];

  const weak = of('weak');
  if (weak[0]) {
    const r = weak[0].reasons;
    out.push(
      `Слабее всего сейчас «${title(weak[0].topic_id)}»: с первой попытки верно ` +
        `${pct(r.first_try_accuracy ?? 0)} из ${count(r.graded_tasks, TASKS_GEN)}.`,
    );
    out.push(advice(r));
  }

  const shaky = of('shaky');
  if (shaky[0]) {
    const r = shaky[0].reasons;
    const why =
      (r.heavy_help_share ?? 0) >= 0.5
        ? `${pct(r.heavy_help_share ?? 0)} решённых задач — после подсказок или разбора`
        : `в среднем ${decimal(r.attempts_per_solved ?? 0)} попытки на решённую задачу`;
    out.push(`«${title(shaky[0].topic_id)}» получается, но пока с трудом: ${why}.`);
    if (!weak[0]) out.push(advice(r));
  }

  const review = of('review_due');
  if (review[0]?.reasons.last_practised) {
    const days = daysBetween(review[0].reasons.last_practised, data.as_of);
    out.push(
      `Пора повторить «${title(review[0].topic_id)}»: последняя практика была ${ago(days)}.`,
    );
  }

  const strong = of('strong');
  if (strong.length) {
    out.push(`Уверенно: ${list(strong.map((t) => title(t.topic_id)))}.`);
  }

  const due = data.counts.mistakes_due;
  if (due > 0) {
    const wait = plural(due, ['ждёт', 'ждут', 'ждут']);
    out.push(`В работе над ошибками ${count(due, TASKS)} ${wait} повтора.`);
  }

  if (out.length === 0) {
    const started = data.topics.some((t) => t.status !== 'not_started');
    out.push(
      started
        ? 'Данных пока немного: решите ещё несколько задач — и картина станет точнее.'
        : 'Пока данных нет: решите несколько задач по любой теме — и я скажу, что получается, а что стоит подтянуть.',
    );
  }
  return out.slice(0, 4);
}

/** Why there is no forecast yet, in one sentence. */
export function missingEvidence(p: Prediction): string {
  const parts: string[] = [];
  if (p.graded_tasks_needed > 0) {
    parts.push(`решите ещё ${count(p.graded_tasks_needed, TASKS_ACC)}`);
  }
  const part1 = p.per_number.filter((n) => n.part === 1 && n.basis === 'none').length;
  const part2 = p.per_number.some((n) => n.part === 2 && n.basis === 'none');
  if (part1 > 0)
    parts.push(`попробуйте задания ${count(part1, ['номера', 'номеров', 'номеров'])} первой части`);
  if (part2) parts.push('решите вариант и оцените вторую часть');
  if (parts.length === 0) return 'Нужно больше данных.';
  const text = parts.join(', ');
  return `Нужно больше данных: ${text}.`;
}
