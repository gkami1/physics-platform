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
  ege_task: number;
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
    tasks: Record<string, TaskNumberSpec>;
  };
  roadmap: { sections: Section[] };
  theory: { topic: string; title: string; status: string; path: string }[];
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

export function theoryUrl(examId: string, topicId: string): string {
  return `/${examId}/theory/${topicId}/`;
}

export function taskUrl(examId: string, taskId: string): string {
  return `/${examId}/tasks/${taskId}/`;
}

export function tasksUrl(examId: string): string {
  return `/${examId}/tasks/`;
}

/** First paragraph of a statement, used as a list preview. */
export function firstParagraph(statement: string): string {
  return statement.trim().split(/\n\s*\n/)[0] ?? '';
}

export function difficultyLabel(d: number): string {
  return ['', 'очень лёгкая', 'лёгкая', 'средняя', 'сложная', 'олимпиадная'][d] ?? '';
}
