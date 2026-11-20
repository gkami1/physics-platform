/**
 * The list a student opened a task from (practice table with its filters, or a catalog
 * number). The task page reads it for its back link, «← Предыдущая / Следующая →» and
 * «Ещё задача». Kept in sessionStorage: per tab, gone when the tab closes.
 */
export interface TaskPool {
  /** Where the back link returns, with the list's filters in the query. */
  back: string;
  /** Back link text without the arrow; the task page's default when absent. */
  backLabel?: string;
  /** Task page paths in the list's order. */
  hrefs: string[];
}

const KEY = 'pp:practice-pool';

/** `/ege/tasks/x` and `/ege/tasks/x/` are the same page (Caddy serves both). */
export function normalizePath(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

export function savePool(pool: TaskPool): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...pool, hrefs: pool.hrefs.map(normalizePath) }),
    );
  } catch {
    // Storage off: the task page keeps its default navigation.
  }
}

/** The saved pool, if the current page is in it. */
export function poolFor(path: string): TaskPool | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const pool = raw ? (JSON.parse(raw) as TaskPool) : null;
    if (!pool || !Array.isArray(pool.hrefs)) return null;
    return pool.hrefs.includes(normalizePath(path)) ? pool : null;
  } catch {
    return null;
  }
}
