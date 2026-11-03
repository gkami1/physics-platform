---
id: ks-lc-04
topics: [electro.oscillations.lc]
difficulty: 2
answer: {type: numeric, value: 10, unit: "мА"}
source: {kind: original}
hints:
  - 'Найди циклическую частоту: $\omega = 1/\sqrt{LC}$.'
  - '$LC = 0{,}1 \cdot 10^{-5} = 10^{-6}$, $\omega = 1000\ \text{рад/с}$.'
  - '$I_{\max} = q_{\max}\,\omega$.'
tutor_notes: 'Ошибки: 0,01 (ответ в А, а просят мА), 1,6 (взяли частоту ν = ω/2π вместо ω).'
status: draft
---
В колебательном контуре с катушкой индуктивностью $0{,}1\ \text{Гн}$ и конденсатором ёмкостью $10\ \text{мкФ}$ максимальный заряд конденсатора $10\ \text{мкКл}$. Найди амплитуду силы тока. Ответ дай в миллиамперах.

## Решение

$$
\omega = \frac{1}{\sqrt{LC}} = \frac{1}{\sqrt{10^{-6}}} = 1000\ \text{рад/с},
\qquad
I_{\max} = q_{\max}\,\omega = 10^{-5} \cdot 1000 = 0{,}01\ \text{А} = 10\ \text{мА}.
$$

Ответ: $10\ \text{мА}$.
