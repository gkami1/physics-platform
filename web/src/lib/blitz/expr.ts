// Formula expressions for the «Блиц» game: parse, render to TeX, compare.
//
// Two readers share one parser. The author's `ask` lines (content/<exam>/formulas.yaml) are
// strict: one letter per variable, a subscript only after `_` (`v_0`, `F_тр`, `E_{к2}`),
// functions written with parentheses. The student's input is forgiving: `_` is optional
// (`v0`), runs of letters are split greedily into the variables the game knows (`mgh`,
// `Fтр`), Cyrillic lookalikes match Latin ones (`Eк` = `Ek`), and `·`, `²`, `√`, `−` work.
//
// Two expressions are equal when they agree at several random values of their variables —
// so `ma`, `a·m` and `m*a` are all right without any algebra.
//
// Implicit multiplication binds tighter than `/` and `*`, the way people write by hand:
// `mv^2/2R` is (m·v²)/(2·R). The live preview shows how the input was read.

export type Fn = 'sin' | 'cos' | 'tg' | 'ctg' | 'sqrt' | 'ln' | 'lg';

export type Node =
  | { k: 'num'; v: number; text: string }
  | { k: 'pi' }
  | { k: 'var'; name: string }
  | { k: 'neg'; a: Node }
  | { k: 'add'; op: '+' | '-'; a: Node; b: Node }
  | { k: 'mul'; implicit: boolean; a: Node; b: Node }
  | { k: 'div'; a: Node; b: Node }
  | { k: 'pow'; a: Node; b: Node }
  | { k: 'fn'; fn: Fn; a: Node; paren: boolean };

export class ExprError extends Error {}

type Tok =
  | { t: 'num'; v: number; text: string }
  | { t: 'pi' }
  | { t: 'var'; name: string }
  | { t: 'fn'; fn: Fn }
  | { t: 'op'; op: '+' | '-' | '*' | '/' | '^' | '(' | ')' | '√' };

const FN_NAMES: Record<string, Fn> = {
  sin: 'sin',
  cos: 'cos',
  tg: 'tg',
  tan: 'tg',
  ctg: 'ctg',
  cot: 'ctg',
  sqrt: 'sqrt',
  ln: 'ln',
  lg: 'lg',
};

const GREEK: Record<string, string> = {
  α: '\\alpha',
  β: '\\beta',
  γ: '\\gamma',
  δ: '\\delta',
  ε: '\\varepsilon',
  η: '\\eta',
  θ: '\\theta',
  λ: '\\lambda',
  μ: '\\mu',
  ν: '\\nu',
  ρ: '\\rho',
  σ: '\\sigma',
  τ: '\\tau',
  φ: '\\varphi',
  ω: '\\omega',
  Γ: '\\Gamma',
  Δ: '\\Delta',
  Φ: '\\Phi',
  Ω: '\\Omega',
};

/** Spelled-out Greek letters a student may type instead of using the palette. */
const GREEK_WORDS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  eta: 'η',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  omega: 'ω',
  Delta: 'Δ',
  Phi: 'Φ',
};

/** Variables whose random test values are angles in radians (kept away from 0 and π/2). */
const ANGLES = new Set(['α', 'β', 'γ', 'θ', 'φ']);

// Cyrillic letters that look like Latin ones, and the Cyrillic Ф for the Greek Φ: a student
// on a Russian layout must not lose a point for `Eк` versus `Ek`. Used only for matching.
const LOOKALIKE: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  Ф: 'Φ',
  ф: 'φ',
  ϕ: 'φ',
  ϵ: 'ε',
};

export function foldName(s: string): string {
  return [...s].map((c) => LOOKALIKE[c] ?? c).join('');
}

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const LETTER = /\p{L}/u;
const DIGIT = /[0-9]/;

function isLetter(c: string | undefined): boolean {
  return c !== undefined && LETTER.test(c);
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && DIGIT.test(c);
}

function readNumber(s: string, i: number): [Tok, number] {
  let j = i;
  while (isDigit(s[j])) j++;
  if (s[j] === '.' && isDigit(s[j + 1])) {
    j++;
    while (isDigit(s[j])) j++;
  } else if (s[j] === '.' && j === i) {
    throw new ExprError('Лишняя точка');
  }
  const text = s.slice(i, j);
  return [{ t: 'num', v: Number(text), text }, j];
}

function readSymbol(c: string): Tok | undefined {
  switch (c) {
    case '+':
    case '-':
    case '*':
    case '/':
    case '^':
    case '(':
    case ')':
    case '√':
      return { t: 'op', op: c };
    case 'π':
      return { t: 'pi' };
  }
  return undefined;
}

// --- author syntax --------------------------------------------------------------------------

function lexAuthor(src: string): Tok[] {
  const s = src.replace(/·/g, '*');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    if (c === ' ') {
      i++;
    } else if (isDigit(c) || c === '.') {
      const [tok, j] = readNumber(s, i);
      out.push(tok);
      i = j;
    } else if (c === 'π') {
      out.push({ t: 'pi' });
      i++;
    } else if (isLetter(c)) {
      const word = /^\p{L}+/u.exec(s.slice(i))?.[0] ?? c;
      const fn = FN_NAMES[word];
      if (fn && (s[i + word.length] === '(' || s[i + word.length] === ' ')) {
        out.push({ t: 'fn', fn });
        i += word.length;
        continue;
      }
      // Δ joins the next letter: Δt, ΔΦ.
      let name = c;
      i++;
      if (c === 'Δ' && isLetter(s[i])) name += s[i++] as string;
      if (s[i] === '_') {
        i++;
        if (s[i] === '{') {
          const end = s.indexOf('}', i);
          if (end < 0) throw new ExprError(`unclosed _{ in «${src}»`);
          name += s.slice(i + 1, end);
          i = end + 1;
        } else {
          const sub = /^[\p{L}0-9]+/u.exec(s.slice(i))?.[0];
          if (!sub) throw new ExprError(`empty subscript in «${src}»`);
          name += sub;
          i += sub.length;
        }
      } else if (isDigit(s[i])) {
        throw new ExprError(`write a subscript with _ («${name}_${s[i]}») in «${src}»`);
      }
      out.push({ t: 'var', name });
    } else {
      const tok = readSymbol(c);
      if (!tok) throw new ExprError(`unexpected «${c}» in «${src}»`);
      out.push(tok);
      i++;
    }
  }
  return out;
}

// --- student syntax -------------------------------------------------------------------------

/** Text the student's input is matched against: known variable → its canonical name. */
export type Known = Map<string, string>;

export function knownNames(names: Iterable<string>): Known {
  const m: Known = new Map();
  for (const n of names) m.set(foldName(n), n);
  return m;
}

function normalizeStudent(src: string): string {
  let s = src
    .replace(/[−–—]/g, '-')
    .replace(/[·×⋅∙•]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/,/g, '.')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/[₀-₉]/g, (d) => String(SUBSCRIPT_DIGITS.indexOf(d)))
    .replace(/_\{([^{}]*)\}/g, '$1')
    .replace(/_/g, '')
    .replace(/[{[]/g, '(')
    .replace(/[}\]]/g, ')');
  // «F = ma» or «a=F/m»: the left side is given, keep what follows the last `=`.
  const eq = s.lastIndexOf('=');
  if (eq >= 0) s = s.slice(eq + 1);
  return s;
}

/** Split a run of letters and digits into known variables, functions and single letters. */
function splitWord(word: string, known: Known, out: Tok[]): void {
  const folded = foldName(word);
  let i = 0;
  while (i < word.length) {
    let best: { len: number; tok: Tok } | undefined;
    const consider = (key: string, tok: Tok) => {
      if (folded.startsWith(key, i) && (!best || key.length > best.len)) {
        best = { len: key.length, tok };
      }
    };
    for (const [key, name] of known) consider(key, { t: 'var', name });
    for (const [key, fn] of Object.entries(FN_NAMES)) consider(key, { t: 'fn', fn });
    for (const [key, letter] of Object.entries(GREEK_WORDS)) {
      consider(key, letter === 'π' ? { t: 'pi' } : { t: 'var', name: letter });
    }
    consider('pi', { t: 'pi' });
    consider('π', { t: 'pi' });
    if (best) {
      i += best.len;
      const tok = best.tok;
      // Digits right after a variable are its subscript: `m2` is m₂ even if only m is known.
      if (tok.t === 'var' && isDigit(word[i])) {
        let j = i;
        while (isDigit(word[j])) j++;
        out.push({ t: 'var', name: tok.name + word.slice(i, j) });
        i = j;
      } else {
        out.push(tok);
      }
      continue;
    }
    const c = word[i] as string;
    if (isDigit(c)) {
      const [tok, j] = readNumber(word, i);
      out.push(tok);
      i = j;
      continue;
    }
    // Unknown letter: a variable of its own, with any digits after it as its subscript.
    let j = i + 1;
    if (c === 'Δ' && isLetter(word[j])) j++;
    while (isDigit(word[j])) j++;
    out.push({ t: 'var', name: word.slice(i, j) });
    i = j;
  }
}

function lexStudent(src: string, known: Known): Tok[] {
  const s = normalizeStudent(src);
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    if (/\s/.test(c)) {
      i++;
    } else if (isDigit(c) || c === '.') {
      const [tok, j] = readNumber(s, i);
      out.push(tok);
      i = j;
    } else if (isLetter(c)) {
      const word = /^\p{L}[\p{L}0-9]*/u.exec(s.slice(i))?.[0] ?? c;
      splitWord(word, known, out);
      i += word.length;
    } else {
      const tok = readSymbol(c);
      if (!tok) throw new ExprError(`Не понимаю символ «${c}»`);
      out.push(tok);
      i++;
    }
  }
  return out;
}

// --- parser ---------------------------------------------------------------------------------

class Parser {
  private i = 0;
  private readonly toks: Tok[];

  // No parameter properties: `node --test` runs this file with type stripping only.
  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  parse(): Node {
    if (this.toks.length === 0) throw new ExprError('Пустой ответ');
    const n = this.sum();
    const rest = this.peek();
    if (rest) {
      throw new ExprError(
        rest.t === 'op' && rest.op === ')' ? 'Лишняя закрывающая скобка' : 'Не могу разобрать запись',
      );
    }
    return n;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private isOp(op: string): boolean {
    const t = this.peek();
    return t !== undefined && t.t === 'op' && t.op === op;
  }

  private sum(): Node {
    let a = this.product();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.toks[this.i++] as { op: '+' | '-' }).op;
      a = { k: 'add', op, a, b: this.product() };
    }
    return a;
  }

  private product(): Node {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const div = this.isOp('/');
      this.i++;
      const b = this.unary();
      a = div ? { k: 'div', a, b } : { k: 'mul', implicit: false, a, b };
    }
    return a;
  }

  private unary(): Node {
    if (this.isOp('-')) {
      this.i++;
      return { k: 'neg', a: this.unary() };
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.chain(false);
  }

  private startsAtom(stopAtFn: boolean): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.t === 'op') return t.op === '(' || t.op === '√';
    return !(stopAtFn && t.t === 'fn');
  }

  /** Implicit product: `2πR`, `mgh`. As a function argument it stops at the next function,
   *  so `sinα cosβ` is sin α · cos β while `sin 2α` is sin(2α). */
  private chain(stopAtFn: boolean): Node {
    let a = this.power();
    while (this.startsAtom(stopAtFn)) {
      a = { k: 'mul', implicit: true, a, b: this.power() };
    }
    return a;
  }

  private power(): Node {
    const base = this.atom();
    if (!this.isOp('^')) return base;
    this.i++;
    let neg = false;
    if (this.isOp('-')) {
      neg = true;
      this.i++;
    }
    const e = this.power();
    return { k: 'pow', a: base, b: neg ? { k: 'neg', a: e } : e };
  }

  private atom(): Node {
    const t = this.toks[this.i++];
    if (!t) throw new ExprError('Запись обрывается');
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v, text: t.text };
      case 'pi':
        return { k: 'pi' };
      case 'var':
        return { k: 'var', name: t.name };
      case 'fn': {
        // sin^2 α: the power applies to the value of the function.
        let exp: Node | undefined;
        if (this.isOp('^')) {
          this.i++;
          exp = this.atom();
        }
        const paren = this.isOp('(');
        const f: Node = { k: 'fn', fn: t.fn, a: this.argument(), paren };
        return exp ? { k: 'pow', a: f, b: exp } : f;
      }
      case 'op':
        if (t.op === '(') {
          const n = this.sum();
          if (!this.isOp(')')) throw new ExprError('Не хватает закрывающей скобки');
          this.i++;
          return n;
        }
        if (t.op === '√') {
          const paren = this.isOp('(');
          return { k: 'fn', fn: 'sqrt', a: this.argument(), paren };
        }
        throw new ExprError(t.op === ')' ? 'Лишняя закрывающая скобка' : `Не хватает числа перед «${t.op}»`);
    }
  }

  private argument(): Node {
    if (this.isOp('(')) return this.atom();
    if (!this.startsAtom(true)) throw new ExprError('Нет аргумента функции');
    return this.chain(true);
  }
}

export function parseAuthor(src: string): Node {
  return new Parser(lexAuthor(src)).parse();
}

export function parseStudent(src: string, known: Known): Node {
  return new Parser(lexStudent(src, known)).parse();
}

/** An authored line `lhs = rhs` (plus accepted alternatives for the right side). */
export interface Formula {
  lhs: Node;
  rhs: Node;
  also: Node[];
}

export function parseFormula(ask: string, also: string[] = []): Formula {
  const parts = ask.split('=');
  if (parts.length !== 2) throw new ExprError(`«${ask}»: exactly one «=» expected`);
  return {
    lhs: parseAuthor(parts[0] as string),
    rhs: parseAuthor(parts[1] as string),
    also: also.map(parseAuthor),
  };
}

// --- variables, evaluation, equivalence -----------------------------------------------------

export function variables(n: Node, into: Set<string> = new Set()): Set<string> {
  switch (n.k) {
    case 'var':
      into.add(n.name);
      break;
    case 'neg':
    case 'fn':
      variables(n.a, into);
      break;
    case 'add':
    case 'mul':
    case 'div':
    case 'pow':
      variables(n.a, into);
      variables(n.b, into);
      break;
  }
  return into;
}

export function evaluate(n: Node, env: Map<string, number>): number {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'pi':
      return Math.PI;
    case 'var':
      return env.get(n.name) ?? Number.NaN;
    case 'neg':
      return -evaluate(n.a, env);
    case 'add': {
      const a = evaluate(n.a, env);
      const b = evaluate(n.b, env);
      return n.op === '+' ? a + b : a - b;
    }
    case 'mul':
      return evaluate(n.a, env) * evaluate(n.b, env);
    case 'div':
      return evaluate(n.a, env) / evaluate(n.b, env);
    case 'pow':
      return evaluate(n.a, env) ** evaluate(n.b, env);
    case 'fn': {
      const a = evaluate(n.a, env);
      switch (n.fn) {
        case 'sin':
          return Math.sin(a);
        case 'cos':
          return Math.cos(a);
        case 'tg':
          return Math.tan(a);
        case 'ctg':
          return 1 / Math.tan(a);
        case 'sqrt':
          return Math.sqrt(a);
        case 'ln':
          return Math.log(a);
        case 'lg':
          return Math.log10(a);
      }
    }
  }
}

/** Small seeded PRNG (mulberry32): equivalence checks are reproducible in tests. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(name: string, random: () => number): number {
  const base = name.replace(/^Δ/, '').charAt(0);
  return ANGLES.has(base) ? 0.2 + random() * 1.1 : 0.5 + random() * 2.5;
}

/** Whether `a` and `b` agree at random positive values of their variables. Points where the
 *  reference is undefined (√ of a negative, v > c) are skipped; at least 4 must be checked. */
export function equivalent(a: Node, b: Node, random: () => number = Math.random): boolean {
  const names = [...variables(a, variables(b))];
  let checked = 0;
  for (let attempt = 0; attempt < 60 && checked < 6; attempt++) {
    const env = new Map(names.map((n) => [n, sample(n, random)]));
    const x = evaluate(a, env);
    if (!Number.isFinite(x)) continue;
    const y = evaluate(b, env);
    if (!Number.isFinite(y)) return false;
    if (Math.abs(x - y) > 1e-7 * Math.max(1, Math.abs(x), Math.abs(y))) return false;
    checked++;
  }
  return checked >= 4;
}

export function matches(f: Formula, answer: Node): boolean {
  return [f.rhs, ...f.also].some((ref) => equivalent(ref, answer));
}

// --- TeX ------------------------------------------------------------------------------------

function letterTex(c: string): string {
  if (GREEK[c]) return GREEK[c];
  return /[a-zA-Z]/.test(c) ? c : `\\text{${c}}`;
}

/** `v0` → v_{0}, `Fтр` → F_{\text{тр}}, `ΔΦ` → \Delta\Phi, `λmax` → \lambda_{\text{max}}. */
export function nameTex(name: string): string {
  const chars = [...name];
  let base = chars.shift() as string;
  if (base === 'Δ' && isLetter(chars[0])) base += chars.shift() as string;
  const baseTex = [...base].map(letterTex).join(base.length > 1 ? ' ' : '');
  if (chars.length === 0) return baseTex;
  const sub = chars.join('');
  const subTex =
    /^[0-9]+$/.test(sub) || /^[a-zA-Z]$/.test(sub)
      ? sub
      : chars.length === 1 && GREEK[sub]
        ? GREEK[sub]
        : `\\text{${sub}}`;
  return `${baseTex}_{${subTex}}`;
}

/** How the student writes a variable: what a palette chip inserts. */
export function nameInput(name: string): string {
  const chars = [...name];
  let base = chars.shift() as string;
  if (base === 'Δ' && isLetter(chars[0])) base += chars.shift() as string;
  return chars.length ? `${base}_${chars.join('')}` : base;
}

const FN_TEX: Record<Fn, string> = {
  sin: '\\sin',
  cos: '\\cos',
  tg: '\\operatorname{tg}',
  ctg: '\\operatorname{ctg}',
  sqrt: '',
  ln: '\\ln',
  lg: '\\lg',
};

const PREC: Record<Node['k'], number> = {
  add: 1,
  neg: 2,
  div: 3,
  mul: 3,
  pow: 5,
  fn: 6,
  num: 7,
  pi: 7,
  var: 7,
};

function wrap(n: Node, min: number): string {
  const tex = toTex(n);
  return PREC[n.k] < min ? `\\left(${tex}\\right)` : tex;
}

function fnTex(n: Extract<Node, { k: 'fn' }>, power?: string): string {
  if (n.fn === 'sqrt') return `\\sqrt{${toTex(n.a)}}`;
  const simple = n.a.k === 'var' || n.a.k === 'num' || n.a.k === 'pi';
  const arg = simple ? ` ${toTex(n.a)}` : `\\left(${toTex(n.a)}\\right)`;
  return `${FN_TEX[n.fn]}${power ? `^{${power}}` : ''}${arg}`;
}

export function toTex(n: Node): string {
  switch (n.k) {
    case 'num':
      return n.text.replace('.', '{,}');
    case 'pi':
      return '\\pi';
    case 'var':
      return nameTex(n.name);
    case 'neg':
      return `-${wrap(n.a, 3)}`;
    case 'add': {
      const b = n.op === '-' ? wrap(n.b, 2) : toTex(n.b);
      return `${toTex(n.a)} ${n.op} ${b}`;
    }
    case 'mul': {
      const a = wrap(n.a, 3);
      const b = wrap(n.b, 4);
      // A number after something else needs a visible dot: m·2, not m2.
      const dot = !n.implicit || n.b.k === 'num' || (n.b.k === 'pow' && n.b.a.k === 'num');
      return dot ? `${a} \\cdot ${b}` : `${a}\\,${b}`;
    }
    case 'div':
      if (n.a.k === 'neg') return `-\\frac{${toTex(n.a.a)}}{${toTex(n.b)}}`;
      return `\\frac{${toTex(n.a)}}{${toTex(n.b)}}`;
    case 'pow':
      if (n.a.k === 'fn' && n.a.fn !== 'sqrt') return fnTex(n.a, toTex(n.b));
      return `${wrap(n.a, 6)}^{${toTex(n.b)}}`;
    case 'fn':
      return fnTex(n);
  }
}
