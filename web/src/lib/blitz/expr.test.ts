// `npm test` (node --test with type stripping): the parser, the checker, and every formula
// in the public build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  ExprError,
  knownNames,
  matches,
  nameInput,
  nameTex,
  parseAuthor,
  parseFormula,
  parseStudent,
  toTex,
  variables,
} from './expr.ts';

function check(ask: string, typed: string): boolean {
  const f = parseFormula(ask);
  const known = knownNames([...variables(f.rhs), ...variables(f.lhs)]);
  return matches(f, parseStudent(typed, known));
}

test('equivalent answers count, different ones do not', () => {
  const cases: [string, string, boolean][] = [
    ['E_к = m v^2/2', 'mv^2/2', true],
    ['E_к = m v^2/2', 'mv²/2', true],
    ['E_к = m v^2/2', '0,5·m·v²', true],
    ['E_к = m v^2/2', 'v^2m/2', true],
    ['E_к = m v^2/2', 'E_к = mv^2/2', true],
    ['E_к = m v^2/2', 'mv/2', false],
    ['E_к = m v^2/2', 'mv^2', false],
    ['F = m a', 'am', true],
    ['F = m a', 'a*m', true],
    ['F = m a', 'm+a', false],
    ['s = v_0 t + a t^2/2', 'v0t + at^2/2', true],
    ['s = v_0 t + a t^2/2', 'v_0 t + at²/2', true],
    ['s = v_0 t + a t^2/2', 'vt + at^2/2', false],
    ['v = sqrt(2 g h)', '√(2gh)', true],
    ['v = sqrt(2 g h)', '√2gh', true],
    ['v = sqrt(2 g h)', 'sqrt(2*g*h)', true],
    ['v = sqrt(2 g h)', '(2gh)^0.5', true],
    ['T = 2 π sqrt(l/g)', '2π√(l/g)', true],
    ['T = 2 π sqrt(l/g)', '2pi sqrt(l/g)', true],
    ['T = 2 π sqrt(l/g)', '2π√(g/l)', false],
    ['h_max = v_0^2 sin(α)^2/(2 g)', 'v0²sin²α/2g', true],
    ['h_max = v_0^2 sin(α)^2/(2 g)', '(v0 sinα)^2/(2g)', true],
    ['h_max = v_0^2 sin(α)^2/(2 g)', 'v0^2 sin(alpha)^2/(2g)', true],
    ['h_max = v_0^2 sin(α)^2/(2 g)', 'v0^2 cos²α/(2g)', false],
    ['L = v_0^2 sin(2 α)/g', 'v0^2*2sinαcosα/g', true],
    ['F_тр = μ N', 'μN', true],
    ['F_тр = μ N', 'muN', true],
    ['F_А = ρ_ж g V_т', 'ρжgVт', true],
    ['F_А = ρ_ж g V_т', 'ρ_ж g V_t', true], // Latin t for Cyrillic т
    ['A = E_{к2} - E_{к1}', 'Eк2 - Eк1', true],
    ['A = E_{к2} - E_{к1}', 'Ek2-Ek1', true],
    ['A = E_{к2} - E_{к1}', 'Eк1 - Eк2', false],
    ['ε_i = ΔΦ/Δt', 'ΔФ/Δt', true], // Cyrillic Ф
    ['F = k q_1 q_2/r^2', 'kq1q2/r^2', true],
    ['F = k q_1 q_2/r^2', 'kq_1q_2/r²', true],
    ['k = 1/(4 π ε_0)', '1/(4πε0)', true],
    ['k = 1/(4 π ε_0)', '1/4πε0', true], // the implicit product stays below the line
    ['N = N_0 2^(-t/T)', 'N0*2^(-t/T)', true],
    ['N = N_0 2^(-t/T)', 'N0/2^(t/T)', true],
    ['E = m c^2/sqrt(1 - v^2/c^2)', 'mc^2/√(1-v^2/c^2)', true],
    ['E = m c^2/sqrt(1 - v^2/c^2)', 'mc^2/√(1-v/c)', false],
    ['Δd = (2 k + 1) λ/2', '(2k+1)λ/2', true],
    ['Δd = (2 k + 1) λ/2', 'kλ + λ/2', true],
    ['A = -ΔU', '−ΔU', true],
    ['A = -ΔU', 'ΔU', false],
    ['η = (T_н - T_х)/T_н', '1 - Tх/Tн', true],
    ['p V = ν R T', 'νRT', true],
  ];
  for (const [ask, typed, want] of cases) {
    assert.equal(check(ask, typed), want, `${ask} ← «${typed}»`);
  }
});

test('also lists alternative right sides', () => {
  const f = parseFormula('T = t + 273', ['t + 273.15']);
  const known = knownNames(['t']);
  assert.ok(matches(f, parseStudent('t+273.15', known)));
  assert.ok(matches(f, parseStudent('273+t', known)));
  assert.ok(!matches(f, parseStudent('t+300', known)));
});

test('unreadable input is an error, not a wrong answer', () => {
  const known = knownNames(['m', 'v']);
  for (const typed of ['', 'mv^2/2)', '(mv^2', 'm v ^', 'm # v', '*m', 'sin']) {
    assert.throws(() => parseStudent(typed, known), ExprError, `«${typed}»`);
  }
});

test('author syntax is strict', () => {
  assert.throws(() => parseAuthor('m1 v'), ExprError); // must be m_1
  assert.throws(() => parseFormula('a = b = c'), ExprError);
  assert.deepEqual(
    [...variables(parseAuthor('m_1 v_{к2} + Δt sin(α)'))],
    ['m1', 'vк2', 'Δt', 'α'],
  );
});

test('TeX rendering', () => {
  const t = (s: string) => toTex(parseAuthor(s));
  assert.equal(t('m v^2/2'), '\\frac{m\\,v^{2}}{2}');
  assert.equal(t('2 π sqrt(l/g)'), '2\\,\\pi\\,\\sqrt{\\frac{l}{g}}');
  assert.equal(t('v_0^2 sin(α)^2/(2 g)'), '\\frac{v_{0}^{2}\\,\\sin^{2} \\alpha}{2\\,g}');
  assert.equal(t('m g (h_1 - h_2)'), 'm\\,g\\,\\left(h_{1} - h_{2}\\right)');
  assert.equal(t('N_0 2^(-t/T)'), 'N_{0} \\cdot 2^{-\\frac{t}{T}}');
  assert.equal(nameTex('Fтр'), 'F_{\\text{тр}}');
  assert.equal(nameTex('ΔΦ'), '\\Delta \\Phi');
  assert.equal(nameTex('λmax'), '\\lambda_{\\text{max}}');
  assert.equal(nameInput('Fтр'), 'F_тр');
  assert.equal(nameInput('Δt'), 'Δt');
});

test('points where the formula is undefined are skipped, not failed', () => {
  // √(1 − v²/c²) is undefined for v > c.
  const f = parseFormula('l = l_0 sqrt(1 - v^2/c^2)');
  const known = knownNames(['l0', 'v', 'c']);
  for (let i = 0; i < 20; i++) {
    assert.ok(matches(f, parseStudent('l0√(1-(v/c)^2)', known)));
  }
});

// Every formula in the public build parses, accepts its own right side typed the way a
// student would, and rejects a changed answer.
const BUILD = path.resolve(import.meta.dirname, '../../../../build/public');
const files = fs.existsSync(BUILD) ? fs.readdirSync(BUILD).filter((f) => f.endsWith('.json')) : [];

test('every authored formula parses and checks', { skip: files.length === 0 && 'no build/public' }, () => {
  let n = 0;
  for (const file of files) {
    const b = JSON.parse(fs.readFileSync(path.join(BUILD, file), 'utf-8')) as {
      formulas?: { title: string; ask: string; also: string[] }[];
    };
    for (const { title, ask, also } of b.formulas ?? []) {
      const f = parseFormula(ask, also);
      const rhs = ask.split('=')[1] as string;
      const known = knownNames([...variables(f.rhs), ...variables(f.lhs)]);
      assert.ok(matches(f, parseStudent(rhs, known)), `${title}: «${ask}» does not match itself`);
      assert.ok(!matches(f, parseStudent(`2*(${rhs})`, known)), `${title}: «${ask}» accepts ×2`);
      for (const alt of also) {
        assert.ok(matches(f, parseStudent(alt, known)), `${title}: also «${alt}»`);
      }
      n++;
    }
  }
  assert.ok(n > 100, `only ${n} formulas`);
});
