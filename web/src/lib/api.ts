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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!r.ok) throw new ApiError(r.status, await r.text());
  return (await r.json()) as T;
}

const task = (id: string) => `/tasks/${encodeURIComponent(id)}`;

export const api = {
  submit: (id: string, answer: string) =>
    call<AttemptResponse>(`${task(id)}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
  state: (id: string) => call<TaskState>(`${task(id)}/state`),
  reveal: (id: string) => call<Solution>(`${task(id)}/reveal`, { method: 'POST' }),
};
