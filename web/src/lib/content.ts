// Public content bundles produced by `content-build build`. Types mirror
// packages/content_schema/src/content_schema/build.py — keep them in sync.
import fs from 'node:fs';
import path from 'node:path';

export interface Topic {
  id: string;
  title: string;
  codifier: string[];
  prereqs: string[];
  ege_tasks: number[];
}

export interface Section {
  id: string;
  title: string;
  topics: Topic[];
}

export interface TaskNumberSpec {
  part: 1 | 2;
  answer_kind: 'numeric' | 'sequence' | 'measurement' | 'extended';
  max_points: number;
  scoring: string;
  title: string;
}

export interface PublicTask {
  id: string;
  /** null: a step task embedded in a theory page, scored by `exam.practice`. */
  ege_task: number | null;
  topics: string[];
  difficulty: number;
  status: 'draft' | 'published';
  statement: string;
  answer_input: { type: TaskNumberSpec['answer_kind']; unit: string | null };
  hint_count: number;
}

export interface PublicBundle {
  content_version: string;
  exam: {
    id: string;
    title: string;
    locale: string;
    season: number;
    verified: boolean;
    duration_minutes: number;
    tasks: Record<string, TaskNumberSpec>;
    practice: TaskNumberSpec | null;
  };
  roadmap: { sections: Section[] };
  /** `tasks`: ids embedded in the page as step tasks, in page order. */
  theory: { topic: string; title: string; status: string; path: string; tasks: string[] }[];
  tasks: PublicTask[];
}

const DIR = path.resolve(process.cwd(), process.env.PUBLIC_CONTENT_DIR ?? '../build/public');

let cache: PublicBundle[] | undefined;

export function bundles(): PublicBundle[] {
  if (!cache) {
    if (!fs.existsSync(DIR)) {
      throw new Error(`No public content at ${DIR}. Run \`npm run content\` first.`);
    }
    cache = fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8')) as PublicBundle);
  }
  return cache;
}

export function bundle(examId: string): PublicBundle {
  const b = bundles().find((x) => x.exam.id === examId);
  if (!b) throw new Error(`Unknown exam ${examId}`);
  return b;
}

export function topicsById(b: PublicBundle): Map<string, Topic> {
  return new Map(b.roadmap.sections.flatMap((s) => s.topics).map((t) => [t.id, t]));
}

/** Scoring spec of a task: its EGE number's, or `practice` for step tasks. */
export function specFor(b: PublicBundle, t: PublicTask): TaskNumberSpec {
  const spec = t.ege_task === null ? b.exam.practice : b.exam.tasks[String(t.ege_task)];
  if (!spec) throw new Error(`Task ${t.id}: no scoring spec for ege_task=${t.ege_task}`);
  return spec;
}

/** Sort key: numbered tasks by number, step tasks first (they are the easiest). */
export function taskOrder(t: PublicTask): number {
  return t.ege_task ?? 0;
}

/** The theory page that embeds a task as a step, if any. */
export function embeddingTopic(b: PublicBundle, taskId: string): string | undefined {
  return b.theory.find((p) => p.tasks.includes(taskId))?.topic;
}

export function theoryUrl(examId: string, topicId: string): string {
  return `/${examId}/theory/${topicId}/`;
}

export function taskUrl(examId: string, taskId: string): string {
  return `/${examId}/tasks/${taskId}/`;
}

/** Practice hub (task table + random task). `/tasks/` redirects here. */
export function tasksUrl(examId: string, topic?: string): string {
  return `/${examId}/practice/${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`;
}

export function variantsUrl(examId: string): string {
  return `/${examId}/variants/`;
}

export function variantUrl(examId: string, n: number): string {
  return `/${examId}/variants/${n}/`;
}

/** Roadmap topics in study order: sections as authored, topics after their prerequisites. */
export function orderedTopics(b: PublicBundle): (Topic & { section: Section })[] {
  const all = b.roadmap.sections.flatMap((s) => s.topics.map((t) => ({ ...t, section: s })));
  const byId = new Map(all.map((t) => [t.id, t]));
  const out: typeof all = [];
  const seen = new Set<string>();
  const visit = (t: (typeof all)[number]) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    for (const p of t.prereqs) {
      const pre = byId.get(p);
      if (pre && pre.section.id === t.section.id) visit(pre);
    }
    out.push(t);
  };
  all.forEach(visit);
  return out;
}

export interface Variant {
  n: number;
  /** One slot per EGE task number; `task` is null when the pool has no task for it yet. */
  slots: { number: number; spec: TaskNumberSpec; task: PublicTask | null }[];
  complete: boolean;
  maxPoints: number;
}

const MAX_VARIANTS = 20;

// Small deterministic PRNG: the same content always yields the same variants.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic exam variants: for every task number, its pool is shuffled once (seeded by the
 * number) and variant k takes item k mod pool size. Published tasks are preferred. */
export function variants(b: PublicBundle): Variant[] {
  const numbers = Object.keys(b.exam.tasks)
    .map(Number)
    .sort((x, y) => x - y);
  const pools = new Map<number, PublicTask[]>();
  for (const n of numbers) {
    const all = b.tasks.filter((t) => t.ege_task === n).sort((x, y) => x.id.localeCompare(y.id));
    const published = all.filter((t) => t.status === 'published');
    const pool = published.length > 0 ? published : all;
    const rnd = mulberry32(n * 7919);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    pools.set(n, pool);
  }
  const count = Math.min(MAX_VARIANTS, Math.max(1, ...[...pools.values()].map((p) => p.length)));
  return Array.from({ length: count }, (_, k) => {
    const slots = numbers.map((number) => {
      const pool = pools.get(number)!;
      return {
        number,
        spec: b.exam.tasks[String(number)]!,
        task: pool.length > 0 ? pool[k % pool.length]! : null,
      };
    });
    return {
      n: k + 1,
      slots,
      complete: slots.every((s) => s.task !== null),
      maxPoints: slots.reduce((sum, s) => sum + (s.task ? s.spec.max_points : 0), 0),
    };
  });
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`;
}

/** First paragraph of a statement, used as a list preview. */
export function firstParagraph(statement: string): string {
  return statement.trim().split(/\n\s*\n/)[0] ?? '';
}

export function difficultyLabel(d: number): string {
  return ['', 'очень лёгкая', 'лёгкая', 'средняя', 'сложная', 'олимпиадная'][d] ?? '';
}
