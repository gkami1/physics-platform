---
id: ks-momentum-06
topics: [mech.conservation.momentum]
difficulty: 3
answer: {type: numeric, value: 400, unit: "Н"}
source: {kind: original}
hints:
  - 'Найди изменение импульса мяча. Скорость сменила направление — это не ноль.'
  - '$|\Delta \vec p| = mv - (-mv) = 2mv$.'
  - '$F = |\Delta \vec p| / \Delta t$.'
tutor_notes: 'Ошибки: 0 (вычли модули импульсов), 200 (взяли Δp = mv, как будто мяч остановился).'
status: draft
---
Мяч массой $0{,}4\ \text{кг}$ летит перпендикулярно стене со скоростью $10\ \text{м/с}$ и отскакивает от неё с той же по модулю скоростью. Удар длился $0{,}02\ \text{с}$. Найди среднюю силу, с которой стена действовала на мяч.

## Решение

Направим ось от стены. До удара $p_{1x} = -0{,}4 \cdot 10 = -4\ \text{кг} \cdot \text{м/с}$, после удара $p_{2x} = +4\ \text{кг} \cdot \text{м/с}$.

$$
\Delta p_x = 4 - (-4) = 8\ \text{кг} \cdot \text{м/с}, \qquad
F = \frac{\Delta p_x}{\Delta t} = \frac{8}{0{,}02} = 400\ \text{Н}.
$$

Ответ: $400\ \text{Н}$.
