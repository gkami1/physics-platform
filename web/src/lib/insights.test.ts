// `npm test`: the rule-based profile text (insights.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ago,
  daysBetween,
  type Insights,
  missingEvidence,
  plural,
  type Prediction,
  type TopicInsight,
  type TopicReasons,
  type TopicStatus,
  tutorSummary,
} from './insights.ts';

const TITLES = { a: 'Законы Ньютона', b: 'Импульс', c: 'Работа', d: 'Газы' };

function reasons(over: Partial<TopicReasons> = {}): TopicReasons {
  return {
    mastery: 0.5,
    graded_tasks: 4,
    first_try_accuracy: 0.25,
    solved_tasks: 2,
    attempts_per_solved: 1,
    heavy_help_share: 0,
    reveals: 0,
    theory_questions: 0,
    task_questions: 0,
    lessons: { total: 3, opened: 3, finished: 3 },
    reading_minutes: 10,
    last_practised: '2026-11-20',
    ...over,
  };
}

const topic = (
  id: string,
  status: TopicStatus,
  over: Partial<TopicReasons> = {},
): TopicInsight => ({
  topic_id: id,
  status,
  reasons: reasons(over),
});

function insights(topics: TopicInsight[], mistakesDue = 0): Insights {
  const counts = Object.fromEntries(
    ['weak', 'shaky', 'review_due', 'in_progress', 'strong', 'not_started'].map((s) => [
      s,
      topics.filter((t) => t.status === s).length,
    ]),
  ) as Insights['counts'];
  counts.mistakes_due = mistakesDue;
  return {
    exam_id: 'ege-physics',
    teaser: false,
    as_of: '2026-11-24T10:00:00Z',
    counts,
    topics,
    practice: [],
    mistakes: [],
    prediction: null,
  };
}

test('plural forms', () => {
  const f: [string, string, string] = ['задача', 'задачи', 'задач'];
  const table: [number, string][] = [
    [1, 'задача'],
    [2, 'задачи'],
    [5, 'задач'],
    [11, 'задач'],
    [12, 'задач'],
    [21, 'задача'],
    [22, 'задачи'],
    [111, 'задач'],
    [0, 'задач'],
  ];
  for (const [n, want] of table) assert.equal(plural(n, f), want, String(n));
});

test('days and ago', () => {
  assert.equal(daysBetween('2026-11-01', '2026-11-24T10:00:00Z'), 23);
  assert.equal(ago(0), 'сегодня');
  assert.equal(ago(1), 'вчера');
  assert.equal(ago(22), '22 дня назад');
  assert.equal(ago(25), '25 дней назад');
});

test('no evidence at all', () => {
  const s = tutorSummary(insights([topic('a', 'not_started')]), TITLES);
  assert.equal(s.length, 1);
  assert.match(s[0], /^Пока данных нет/);
});

test('started but nothing to say yet', () => {
  const s = tutorSummary(insights([topic('a', 'in_progress')]), TITLES);
  assert.match(s[0], /^Данных пока немного/);
});

test('weak topic: accuracy from the numbers, then reading advice', () => {
  const s = tutorSummary(
    insights([topic('a', 'weak', { lessons: { total: 5, opened: 2, finished: 1 } })]),
    TITLES,
  );
  assert.equal(
    s[0],
    'Слабее всего сейчас «Законы Ньютона»: с первой попытки верно 25 % из 4 задач.',
  );
  assert.equal(s[1], 'Теория дочитана на 1 из 5 уроков — стоит закончить.');
});

test('weak topic advice: unread theory, then the tutor, then practice', () => {
  const unread = { lessons: { total: 2, opened: 0, finished: 0 } };
  assert.match(
    tutorSummary(insights([topic('a', 'weak', unread)]), TITLES)[1],
    /^Начните с теории/,
  );
  assert.match(tutorSummary(insights([topic('a', 'weak')]), TITLES)[1], /репетитором/);
  const asked = { task_questions: 3 };
  assert.match(tutorSummary(insights([topic('a', 'weak', asked)]), TITLES)[1], /тренировки/);
});

test('shaky: heavy help or many attempts', () => {
  const help = tutorSummary(insights([topic('b', 'shaky', { heavy_help_share: 0.67 })]), TITLES);
  assert.equal(
    help[0],
    '«Импульс» получается, но пока с трудом: 67 % решённых задач — после подсказок или разбора.',
  );
  const tries = tutorSummary(
    insights([topic('b', 'shaky', { attempts_per_solved: 2.75 })]),
    TITLES,
  );
  assert.match(tries[0], /в среднем 2,8 попытки на решённую задачу/);
});

test('review due counts days from the last practice', () => {
  const s = tutorSummary(
    insights([topic('c', 'review_due', { last_practised: '2026-11-01' })]),
    TITLES,
  );
  assert.equal(s[0], 'Пора повторить «Работа»: последняя практика была 23 дня назад.');
});

test('strengths and mistakes; at most four sentences, most urgent first', () => {
  const s = tutorSummary(
    insights(
      [
        topic('a', 'weak'),
        topic('b', 'shaky', { heavy_help_share: 1 }),
        topic('c', 'review_due', { last_practised: '2026-11-01' }),
        topic('d', 'strong'),
      ],
      2,
    ),
    TITLES,
  );
  assert.equal(s.length, 4);
  assert.match(s[0], /^Слабее всего/);
  assert.match(s[2], /^«Импульс»/);
  assert.match(s[3], /^Пора повторить/);
});

test('strong list and mistakes sentence', () => {
  const s = tutorSummary(
    insights([topic('a', 'strong'), topic('b', 'strong'), topic('c', 'strong')], 1),
    TITLES,
  );
  assert.equal(s[0], 'Уверенно: «Законы Ньютона», «Импульс» и ещё 1.');
  assert.equal(s[1], 'В работе над ошибками 1 задача ждёт повтора.');
});

test('missing evidence names what to do', () => {
  const p: Prediction = {
    enough_data: false,
    max_primary: 45,
    primary: null,
    test: null,
    scale_season: null,
    per_number: [
      {
        number: 1,
        part: 1,
        max_points: 1,
        expected: null,
        basis: 'none',
        mastery_tasks: 0,
        variant_runs: 0,
      },
      {
        number: 2,
        part: 1,
        max_points: 1,
        expected: 1,
        basis: 'mastery',
        mastery_tasks: 3,
        variant_runs: 0,
      },
      {
        number: 21,
        part: 2,
        max_points: 3,
        expected: null,
        basis: 'none',
        mastery_tasks: 0,
        variant_runs: 0,
      },
    ],
    missing_numbers: [1, 21],
    graded_tasks_needed: 12,
  };
  assert.equal(
    missingEvidence(p),
    'Нужно больше данных: решите ещё 12 задач, попробуйте задания 1 номера первой части, решите вариант и оцените вторую часть.',
  );
});
