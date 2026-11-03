---
id: ks-accel-07
topics: [mech.kinematics.uniform-accel]
difficulty: 2
answer: {type: numeric, value: -8, unit: "м/с"}
source: {kind: original}
hints:
  - 'Сравни с $x = x_0 + v_{0x}t + \dfrac{a_x t^2}{2}$: что стоит перед $t$, а что перед $t^2$?'
  - '$v_{0x} = 4\ \text{м/с}$. Перед $t^2$ стоит $\dfrac{a_x}{2} = -2$, значит, $a_x = -4\ \text{м/с}^2$.'
  - '$v_x = v_{0x} + a_x t$.'
tutor_notes: 'Главная ловушка — взять a = −2 (ответ −2). Ещё одна — подставить t в формулу координаты и получить x = −1.'
status: draft
---
Координата тела меняется по закону $x = 5 + 4t - 2t^2$ (все величины в СИ). Найди проекцию скорости тела $v_x$ в момент $t = 3\ \text{с}$.

## Решение

Сравниваем с $x = x_0 + v_{0x}t + \dfrac{a_x t^2}{2}$:

$v_{0x} = 4\ \text{м/с}$, $\dfrac{a_x}{2} = -2$, то есть $a_x = -4\ \text{м/с}^2$.

$$
v_x = 4 - 4 \cdot 3 = -8\ \text{м/с}.
$$

Ответ: $-8\ \text{м/с}$.
