// «Блиц»: a timed round of formulas. The player sees a formula's title and left side and
// types the right side; answers are checked in the browser (expr.ts). Nothing is sent to the
// API: formulas are public theory, and records live in this browser's localStorage.
import katex from 'katex';
import {
  ExprError,
  type Formula,
  knownNames,
  matches,
  nameInput,
  nameTex,
  parseFormula,
  parseStudent,
  toTex,
  variables,
} from './expr';

export interface BlitzData {
  exam: string;
  sections: { id: string; title: string }[];
  /** `s`: index into `sections`; `topic`: the roadmap topic's title. */
  formulas: { s: number; topic: string; title: string; ask: string; also: string[] }[];
}

interface Item {
  s: number;
  topic: string;
  title: string;
  f: Formula;
  /** Variables of the right side(s): the palette offers them with a few decoys. */
  vars: string[];
}

interface Miss {
  item: Item;
  /** What the player typed (TeX), or null for «Не помню». */
  yours: string | null;
}

const STREAK_BONUS_EVERY = 5;
const STREAK_BONUS_SECONDS = 5;
const DECOYS = 3;
const NEXT_AFTER_OK_MS = 450;
const NEXT_AFTER_MISS_MS = 3000;

function tex(src: string, display = true): string {
  return katex.renderToString(src, { displayMode: display, throwOnError: false });
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface Best {
  score: number;
  streak: number;
}

class FormulaBlitz extends HTMLElement {
  private items: Item[] = [];
  private data!: BlitzData;

  // Round state.
  private pool: Item[] = [];
  private deck: Item[] = [];
  private current: Item | null = null;
  private score = 0;
  private streak = 0;
  private bestStreak = 0;
  private asked = 0;
  private misses: Miss[] = [];
  private deadline = 0;
  private duration = 60;
  private ticker = 0;
  private advance = 0;
  private locked = false;
  private practice = false; // «Повторить ошибки»: no record is kept
  private known = knownNames([]);

  connectedCallback(): void {
    const json = this.querySelector('.blitz-data')?.textContent ?? '{}';
    this.data = JSON.parse(json) as BlitzData;
    for (const f of this.data.formulas) {
      try {
        const formula = parseFormula(f.ask, f.also);
        const vars = new Set<string>();
        for (const side of [formula.rhs, ...formula.also]) variables(side, vars);
        this.items.push({ s: f.s, topic: f.topic, title: f.title, f: formula, vars: [...vars] });
      } catch (e) {
        // The web tests parse every formula; a bad line is skipped rather than breaking the page.
        console.error(`blitz: «${f.ask}»`, e);
      }
    }

    this.$('.start').addEventListener('click', () => this.start(false));
    this.$('.again').addEventListener('click', () => this.start(false));
    this.$('.retry').addEventListener('click', () => this.start(true));
    this.$('.menu').addEventListener('click', () => this.show('start'));
    this.$('.skip').addEventListener('click', () => this.giveUp());
    this.$('.stop').addEventListener('click', () => this.finish());
    this.$<HTMLFormElement>('.answer').addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.locked) this.next();
      else this.submit();
    });
    this.input.addEventListener('input', () => this.preview());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.locked) this.next();
        else this.giveUp();
      }
    });
    // Palette keys insert at the caret without taking focus from the field (no keyboard flicker
    // on phones).
    this.$('.palette').addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    this.$('.palette').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.toggle')) {
        this.$('.palette').toggleAttribute('data-greek');
        return;
      }
      const key = target.closest<HTMLButtonElement>('button[data-insert]');
      if (key?.dataset.insert) this.insert(key.dataset.insert);
    });
    this.querySelectorAll('input[name="section"], input[name="duration"]').forEach((el) =>
      el.addEventListener('change', () => this.showRecord()),
    );
    this.showRecord();
  }

  disconnectedCallback(): void {
    window.clearInterval(this.ticker);
    window.clearTimeout(this.advance);
  }

  private $<T extends HTMLElement = HTMLElement>(sel: string): T {
    const el = this.querySelector<T>(sel);
    if (!el) throw new Error(`blitz: no ${sel}`);
    return el;
  }

  private get input(): HTMLInputElement {
    return this.$<HTMLInputElement>('.input');
  }

  private show(screen: 'start' | 'play' | 'end'): void {
    this.$('.b-start').hidden = screen !== 'start';
    this.$('.b-play').hidden = screen !== 'play';
    this.$('.b-end').hidden = screen !== 'end';
    if (screen === 'start') this.showRecord();
    window.scrollTo({ top: 0 });
  }

  // --- setup and records ----------------------------------------------------------------------

  private choice(name: string): string {
    return this.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
  }

  private recordKey(): string {
    return `pp:blitz:${this.data.exam}:${this.choice('section')}:${this.choice('duration')}`;
  }

  private record(): Best | null {
    try {
      const raw = storage()?.getItem(this.recordKey());
      return raw ? (JSON.parse(raw) as Best) : null;
    } catch {
      return null;
    }
  }

  private showRecord(): void {
    const r = this.record();
    this.$('.record').textContent = r
      ? `Рекорд: ${r.score} верных · лучшая серия ${r.streak}`
      : 'Рекорда пока нет — самое время поставить.';
  }

  // --- round ----------------------------------------------------------------------------------

  private start(practice: boolean): void {
    this.practice = practice;
    if (practice) {
      this.pool = this.misses.map((m) => m.item);
    } else {
      const section = this.choice('section');
      const idx = this.data.sections.findIndex((s) => s.id === section);
      this.pool = idx < 0 ? this.items : this.items.filter((i) => i.s === idx);
    }
    this.duration = Number(this.choice('duration')) || 60;
    if (this.pool.length === 0) return;
    this.deck = [];
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.asked = 0;
    this.misses = [];
    this.current = null;
    this.setStat('.score', 0, false);
    this.setStat('.streak', 0, false);
    this.show('play');
    this.deadline = performance.now() + this.duration * 1000;
    window.clearInterval(this.ticker);
    this.ticker = window.setInterval(() => this.tick(), 200);
    this.tick();
    this.next();
  }

  private tick(): void {
    const left = Math.max(0, this.deadline - performance.now());
    const s = Math.ceil(left / 1000);
    this.$('.clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const frac = Math.min(1, left / (this.duration * 1000));
    this.$('.fill').style.transform = `scaleX(${frac})`;
    this.$('.timer').toggleAttribute('data-low', s <= 10);
    if (left <= 0) this.finish();
  }

  private draw(): Item {
    if (this.deck.length === 0) {
      this.deck = shuffle(this.pool);
      // No formula twice in a row across a reshuffle.
      if (this.deck.length > 1 && this.deck[this.deck.length - 1] === this.current) {
        this.deck.unshift(this.deck.pop() as Item);
      }
    }
    return this.deck.pop() as Item;
  }

  private next(): void {
    window.clearTimeout(this.advance);
    if (this.$('.b-play').hidden) return;
    const item = this.draw();
    this.current = item;
    this.locked = false;
    this.asked++;

    const card = this.$('.q');
    card.classList.remove('ok', 'bad');
    this.$('.topic').textContent = item.topic;
    this.$('.q-count').textContent = `№ ${this.asked}`;
    this.$('.q-title').textContent = item.title;
    this.setFeedback('', '');

    // Palette: this formula's quantities plus a few decoys from the same section.
    const own = new Set(item.vars);
    const others = shuffle([
      ...new Set(
        this.pool
          .concat(this.items.filter((i) => i.s === item.s))
          .flatMap((i) => i.vars)
          .filter((v) => !own.has(v)),
      ),
    ]).slice(0, DECOYS);
    const chips = shuffle([...own, ...others]);
    const lhsVars = variables(item.f.lhs);
    this.known = knownNames([...chips, ...lhsVars]);
    const row = this.$('.vars');
    row.replaceChildren(
      ...chips.map((name) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.insert = nameInput(name);
        b.innerHTML = tex(nameTex(name), false);
        return b;
      }),
    );

    const input = this.input;
    input.value = '';
    input.readOnly = false;
    this.$<HTMLButtonElement>('.check').textContent = 'Ответить';
    this.$<HTMLButtonElement>('.skip').disabled = false;
    this.preview();
    input.focus({ preventScroll: true });
  }

  private lhsTex(): string {
    return this.current ? toTex(this.current.f.lhs) : '';
  }

  private preview(): void {
    if (!this.current || this.locked) return;
    const box = this.$('.q-formula');
    const text = this.input.value.trim();
    if (!text) {
      box.innerHTML = tex(`${this.lhsTex()} = \\boxed{\\phantom{xx}?\\phantom{xx}}`);
      return;
    }
    try {
      box.innerHTML = tex(`${this.lhsTex()} = ${toTex(parseStudent(text, this.known))}`);
    } catch {
      // Half-typed input: show the left side and the raw text until it parses.
      box.innerHTML = `<div>${tex(`${this.lhsTex()} =`, false)} <span class="raw"></span></div>`;
      (box.querySelector('.raw') as HTMLElement).textContent = text;
    }
  }

  private submit(): void {
    const item = this.current;
    if (!item) return;
    const text = this.input.value.trim();
    if (!text) {
      this.setFeedback('hint', 'Введите правую часть формулы — или нажмите «Не помню».');
      return;
    }
    let answer;
    try {
      answer = parseStudent(text, this.known);
    } catch (e) {
      // Unreadable input is not a wrong answer: say what's off and let them fix it.
      this.setFeedback('hint', e instanceof ExprError ? e.message : 'Не могу разобрать запись');
      return;
    }
    if (matches(item.f, answer)) this.correct();
    else this.miss(toTex(answer));
  }

  private correct(): void {
    this.locked = true;
    this.score++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.setStat('.score', this.score, true);
    this.setStat('.streak', this.streak, true);
    let msg = 'Верно!';
    if (this.streak % STREAK_BONUS_EVERY === 0) {
      this.deadline += STREAK_BONUS_SECONDS * 1000;
      this.duration = Math.max(this.duration, (this.deadline - performance.now()) / 1000);
      msg = `Серия ${this.streak}! +${STREAK_BONUS_SECONDS} секунд`;
      const bonus = this.$('.bonus');
      bonus.textContent = `+${STREAK_BONUS_SECONDS} с`;
      bonus.classList.remove('show');
      void bonus.offsetWidth; // restart the animation
      bonus.classList.add('show');
      this.tick();
    }
    this.setFeedback('ok', msg);
    this.flash('ok');
    this.advance = window.setTimeout(() => this.next(), NEXT_AFTER_OK_MS);
  }

  private miss(yours: string | null): void {
    const item = this.current;
    if (!item) return;
    this.locked = true;
    this.streak = 0;
    this.setStat('.streak', 0, false);
    if (!this.misses.some((m) => m.item === item)) this.misses.push({ item, yours });
    this.input.readOnly = true;
    this.$<HTMLButtonElement>('.check').textContent = 'Дальше';
    this.$<HTMLButtonElement>('.skip').disabled = true;
    this.$('.q-formula').innerHTML = tex(`${this.lhsTex()} = ${toTex(item.f.rhs)}`);
    this.setFeedback('bad', yours === null ? 'Вот эта формула:' : 'Не так. Правильно:');
    this.flash('bad');
    this.advance = window.setTimeout(() => this.next(), NEXT_AFTER_MISS_MS);
  }

  private giveUp(): void {
    if (!this.locked) this.miss(null);
  }

  private finish(): void {
    window.clearInterval(this.ticker);
    window.clearTimeout(this.advance);
    if (this.$('.b-play').hidden) return;
    this.current = null;

    this.$('.over').textContent = this.deadline <= performance.now() ? 'Время вышло' : 'Раунд окончен';
    this.$('.final').textContent = String(this.score);
    const tried = this.score + this.misses.length;
    this.$('.summary').textContent =
      `Формул: ${tried} · лучшая серия: ${this.bestStreak}` +
      (this.practice ? ' · тренировка ошибок, без рекорда' : '');

    let isRecord = false;
    if (!this.practice && this.score > 0) {
      const prev = this.record();
      isRecord = !prev || this.score > prev.score;
      const next: Best = {
        score: Math.max(this.score, prev?.score ?? 0),
        streak: Math.max(this.bestStreak, prev?.streak ?? 0),
      };
      try {
        storage()?.setItem(this.recordKey(), JSON.stringify(next));
      } catch {
        // Private mode or full storage: the record lasts for this page only.
      }
    }
    this.$('.new-record').hidden = !isRecord;

    const list = this.$('.missed');
    list.replaceChildren(
      ...this.misses.map(({ item, yours }) => {
        const li = document.createElement('li');
        const t = document.createElement('div');
        t.className = 't';
        t.textContent = item.title;
        li.append(t);
        li.insertAdjacentHTML('beforeend', tex(`${toTex(item.f.lhs)} = ${toTex(item.f.rhs)}`));
        if (yours) {
          const y = document.createElement('div');
          y.className = 'yours';
          y.innerHTML = `Ваш ответ: ${tex(`\\displaystyle ${yours}`, false)}`;
          li.append(y);
        }
        return li;
      }),
    );
    this.$('.review').hidden = this.misses.length === 0;
    this.$('.retry').hidden = this.misses.length === 0;
    this.show('end');
  }

  // --- ui helpers -----------------------------------------------------------------------------

  private insert(text: string): void {
    const input = this.input;
    if (input.readOnly) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(text, start, end, 'end');
    input.focus({ preventScroll: true });
    this.preview();
  }

  private setFeedback(kind: '' | 'ok' | 'bad' | 'hint', text: string): void {
    const el = this.$('.feedback');
    el.dataset.kind = kind;
    el.textContent = text;
  }

  private setStat(sel: string, value: number, pop: boolean): void {
    const stat = this.$(sel);
    const v = stat.querySelector('.v') as HTMLElement;
    v.textContent = String(value);
    if (sel === '.streak') stat.toggleAttribute('data-hot', value >= 3);
    v.classList.remove('pop');
    if (pop) {
      void v.offsetWidth;
      v.classList.add('pop');
    }
  }

  private flash(kind: 'ok' | 'bad'): void {
    const card = this.$('.q');
    card.classList.remove('ok', 'bad');
    void card.offsetWidth;
    card.classList.add(kind);
  }
}

customElements.define('formula-blitz', FormulaBlitz);
