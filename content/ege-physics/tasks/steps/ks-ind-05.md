---
id: ks-ind-05
topics: [electro.induction.faraday]
difficulty: 2
answer: {type: numeric, value: 0.02, unit: "А"}
source: {kind: original}
hints:
  - 'Сначала ЭДС: $|\mathcal{E}_i| = S \dfrac{\Delta B}{\Delta t}$, $S = 0{,}01\ \text{м}^2$.'
  - 'Потом закон Ома: $I = |\mathcal{E}_i|/R$.'
tutor_notes: 'Ошибки: 0,0002 (умножили ЭДС на R вместо деления), 200 (площадь оставили в см²), 0,002 (нашли ЭДС, а не ток).'
status: draft
---
Проволочная рамка площадью $100\ \text{см}^2$ и сопротивлением $0{,}1\ \text{Ом}$ находится в магнитном поле, перпендикулярном её плоскости. Индукция поля равномерно растёт со скоростью ${0{,}2\ \text{Тл/с}.}$ Найди силу индукционного тока в рамке. Ответ дай в амперах.

## Решение

$$
|\mathcal{E}_i| = S \frac{\Delta B}{\Delta t} = 0{,}01 \cdot 0{,}2 = 2 \cdot 10^{-3}\ \text{В},
\qquad
I = \frac{|\mathcal{E}_i|}{R} = \frac{2 \cdot 10^{-3}}{0{,}1} = 0{,}02\ \text{А}.
$$

Ответ: $0{,}02\ \text{А}$.
