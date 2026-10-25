// Typed client for the platform API. Shapes mirror api/src/platform_api/main.py.
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
  user: { email: string } | null;
}

export interface Progress {
  topics: { exam_id: string; topic_id: string; score: number; n: number }[];
}

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

export const api = {
  submit: (id: string, answer: string) =>
    call<AttemptResponse>(`${task(id)}/attempts`, post({ answer })),
  state: (id: string) => call<TaskState>(`${task(id)}/state`),
  reveal: (id: string) => call<Solution>(`${task(id)}/reveal`, post()),
  progress: () => call<Progress>('/progress'),
  me: () => call<Me>('/me'),
  requestCode: (email: string, consent: boolean) =>
    call<{ expires_in: number }>('/auth/code', post({ email, consent })),
  verifyCode: (email: string, code: string) => call<Me>('/auth/verify', post({ email, code })),
  logout: () => call<void>('/auth/logout', post()),
};
