// Reading evidence for the profile (ARCHITECTURE §10): active seconds on a theory page and
// whether the reader reached the end of the text. Time counts only while the tab is visible
// and the reader did something in the last two minutes. Failures are ignored: this is
// analytics, never in the reader's way.

const TICK_MS = 5_000;
const IDLE_MS = 120_000;
const FLUSH_MS = 60_000;
/** Scrolling to the end in a few seconds is not reading it. */
const MIN_FINISH_S = 30;
/** The API rejects a larger delta. */
const MAX_DELTA_S = 300;

export function trackReading(pageId: string, end: Element | null): void {
  let unsent = 0; // active seconds not yet sent
  let total = 0; // active seconds on this page load
  let lastInput = Date.now();
  let firstPing = true;
  let reachedEnd = false;
  let finishedSent = false;

  const send = () => {
    const finished = reachedEnd && total >= MIN_FINISH_S;
    const delta = Math.min(unsent, MAX_DELTA_S);
    if (!firstPing && delta === 0 && (!finished || finishedSent)) return;
    unsent -= delta;
    const body = { page_id: pageId, active_s: delta, new_visit: firstPing, finished };
    firstPing = false;
    finishedSent ||= finished;
    // keepalive lets the last ping survive the page being closed.
    void fetch('/api/theory/visits', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  };

  const touch = () => {
    lastInput = Date.now();
  };
  for (const ev of ['scroll', 'pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    addEventListener(ev, touch, { passive: true });
  }

  setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastInput < IDLE_MS) {
      unsent += TICK_MS / 1000;
      total += TICK_MS / 1000;
      if (reachedEnd && !finishedSent && total >= MIN_FINISH_S) send();
    }
  }, TICK_MS);
  setInterval(send, FLUSH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
    else touch();
  });
  addEventListener('pagehide', send);

  if (end) {
    new IntersectionObserver((entries, observer) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      reachedEnd = true;
      observer.disconnect();
      if (total >= MIN_FINISH_S) send();
    }).observe(end);
  }

  send(); // the visit itself
}
