// A variant in progress, kept in localStorage until it is submitted: the timer survives
// reloads and closed tabs (time keeps running, as on the real exam).

export interface VariantState {
  startedAt: number; // epoch ms
  deadline: number; // epoch ms
  answers: Record<string, string>; // task id -> raw answer
}

const key = (exam: string, n: number) => `pp:variant:${exam}:${n}`;

export function loadState(exam: string, n: number): VariantState | null {
  try {
    const raw = localStorage.getItem(key(exam, n));
    const s = raw ? (JSON.parse(raw) as VariantState) : null;
    return s && typeof s.deadline === 'number' && typeof s.answers === 'object' ? s : null;
  } catch {
    return null;
  }
}

export function saveState(exam: string, n: number, s: VariantState): void {
  try {
    localStorage.setItem(key(exam, n), JSON.stringify(s));
  } catch {
    // Storage full or off: the run still works until the tab closes.
  }
}

export function clearState(exam: string, n: number): void {
  try {
    localStorage.removeItem(key(exam, n));
  } catch {
    // Nothing to clear.
  }
}

/** 3725 s -> "1:02:05"; under an hour -> "02:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
