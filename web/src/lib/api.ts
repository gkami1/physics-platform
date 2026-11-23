// Typed client for the platform API. Shapes mirror api/src/platform_api/main.py.
import { LEGAL_VERSION } from './seller';

export type Outcome = 'correct' | 'partial' | 'wrong' | 'invalid';

export interface AttemptResponse {
  outcome: Outcome;
  points: number;
  max_points: number;
  normalized: string | null;
  solution_available: boolean;
}

export interface TaskState {
  attempts: {
    outcome: Outcome | 'revealed';
    points: number;
    max_points: number;
    answer: string | null;
    created_at: string;
  }[];
  best_points: number;
  max_points: number;
  solution_available: boolean;
}

export interface Solution {
  answer: string | null;
  solution: string;
}

export interface Me {
  /** `paid_until`: end of paid access (ISO, UTC), null without an active pass. */
  user: { email: string; paid_until: string | null } | null;
}

export type PlanId = 'month' | 'season';

export interface Plan {
  id: PlanId;
  title: string;
  price_kop: number;
  /** What buying it now gives someone without access. */
  valid_until: string;
}

export interface Plans {
  plans: Plan[];
  /** False until the shop is configured on the server. */
  enabled: boolean;
  paid_until: string | null;
}

/** Version of the personal-data consent text shown on the login page. */
export const CONSENT_VERSION = LEGAL_VERSION;

export interface Progress {
  topics: { exam_id: string; topic_id: string; score: number; n: number }[];
}

export interface VariantTaskResult {
  task_id: string;
  ege_task: number;
  part: number;
  /** Checker outcome, or "self" (Part 2, to self-assess) / "skipped" (left empty). */
  outcome: Outcome | 'self' | 'skipped';
  points: number;
  max_points: number;
  answer: string | null;
}

export interface VariantRun {
  id: number;
  exam_id: string;
  variant: number;
  results: VariantTaskResult[];
  auto_points: number;
  self_points: Record<string, number>;
  total_points: number;
  max_points: number;
  pending: number;
  duration_s: number | null;
  created_at: string;
}

export type VariantRunSummary = Pick<
  VariantRun,
  'id' | 'exam_id' | 'variant' | 'total_points' | 'max_points' | 'pending' | 'created_at'
>;

export type TaskStatus = 'solved' | 'attempted';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Machine-readable reason from the API, e.g. "wrong_code". */
    readonly detail: string,
  ) {
    super(`${status} ${detail}`);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    throw new ApiError(r.status, typeof body.detail === 'string' ? body.detail : '');
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

const task = (id: string) => `/tasks/${encodeURIComponent(id)}`;

let sessionOnce: Promise<Me> | undefined;

/**
 * Who is signed in, asked once per page load and shared by every island (header, tutor
 * chat). Rejects when the API is unreachable.
 */
export function session(): Promise<Me> {
  sessionOnce ??= api.me();
  return sessionOnce;
}

export const api = {
  submit: (id: string, answer: string) =>
    call<AttemptResponse>(`${task(id)}/attempts`, post({ answer })),
  state: (id: string) => call<TaskState>(`${task(id)}/state`),
  reveal: (id: string) => call<Solution>(`${task(id)}/reveal`, post()),
  progress: () => call<Progress>('/progress'),
  me: () => call<Me>('/me'),
  requestCode: (email: string, consent: boolean) =>
    call<{ expires_in: number }>('/auth/code', post({ email, consent })),
  verifyCode: (email: string, code: string) =>
    call<Me>('/auth/verify', post({ email, code, consent_version: CONSENT_VERSION })),
  plans: () => call<Plans>('/billing/plans'),
  checkout: (plan: PlanId) =>
    call<{ url: string }>('/billing/checkout', post({ plan, accept_offer: true })),
  payment: (invoiceId: string) =>
    call<{ status: 'pending' | 'paid'; paid_until: string | null }>(
      `/billing/payments/${encodeURIComponent(invoiceId)}`,
      { cache: 'no-store' },
    ),
  logout: () => call<void>('/auth/logout', post()),
  taskStatuses: () => call<{ tasks: Record<string, TaskStatus> }>('/tasks/status'),
  submitVariant: (body: {
    exam_id: string;
    variant: number;
    tasks: string[];
    answers: Record<string, string>;
    duration_s: number;
  }) => call<VariantRun>('/variants/runs', post(body)),
  selfAssess: (runId: number, points: Record<string, number>) =>
    call<VariantRun>(`/variants/runs/${runId}/self-assessment`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
    }),
  variantRun: (runId: number) => call<VariantRun>(`/variants/runs/${runId}`),
  variantRuns: (examId: string) =>
    call<VariantRunSummary[]>(`/variants/runs?exam_id=${encodeURIComponent(examId)}`),
};

export type TutorKind = 'task' | 'theory';

export interface TutorMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  hint_level: number | null;
  leak: boolean;
  created_at: string;
}

export interface TutorThread {
  messages: TutorMessage[];
  hint_level: number | null;
  max_hint_level: number;
  messages_left: number;
  daily_limit: number;
  /** Has an active pass (the cap may still be the free one under fair use). */
  paid: boolean;
}

export interface Allowance {
  messages_left: number;
  daily_limit: number;
  paid: boolean;
}

/** «до 30 июня 2027» style date in Moscow time. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });
}

/** 69000 → «690 ₽». */
export function formatRub(kop: number): string {
  const rub = kop / 100;
  return `${rub.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

export type TutorEvent =
  | { event: 'meta'; data: { hint_level: number | null } & Allowance }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { message_id: number | null; leak: boolean } }
  | { event: 'error'; data: { detail: string } };

export const tutor = {
  thread: (kind: TutorKind, id: string) =>
    call<TutorThread>(`/tutor/thread?kind=${kind}&id=${encodeURIComponent(id)}`),

  /** POST a message and read the SSE reply (EventSource can't POST). */
  async send(
    body: { kind: TutorKind; id: string; text: string; intent: 'message' | 'hint' },
    onEvent: (e: TutorEvent) => void,
  ): Promise<void> {
    const r = await fetch('/api/tutor/messages', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok || !r.body) {
      const err = (await r.json().catch(() => ({}))) as { detail?: unknown };
      throw new ApiError(r.status, typeof err.detail === 'string' ? err.detail : '');
    }
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let end: number;
      while ((end = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, end);
        buf = buf.slice(end + 2);
        let event = '';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (event && data) onEvent({ event, data: JSON.parse(data) } as TutorEvent);
      }
    }
  },
};
