---
id: ks-emf-05
topics: [electro.circuits.emf]
difficulty: 3
answer: {type: numeric, value: 1, unit: "Ом"}
source: {kind: original}
hints:
  - 'Запиши закон Ома для полной цепи для обоих опытов: $\mathcal{E} = I_1(R_1 + r)$ и $\mathcal{E} = I_2(R_2 + r)$.'
  - 'ЭДС одна и та же — приравняй правые части.'
  - '$2(2 + r) = 1 \cdot (5 + r)$.'
tutor_notes: 'Ошибки: 6 (нашли ЭДС вместо r), 0 (не учли r, получили противоречие и решили, что r = 0).'
status: draft
---
Когда к источнику подключили резистор $2\ \text{Ом}$, ток в цепи был ${2\ \text{А}.}$ Когда резистор заменили на $5\ \text{Ом}$, ток стал ${1\ \text{А}.}$ Найди внутреннее сопротивление источника.

## Решение

ЭДС в обоих опытах одна:

$$
2 \cdot (2 + r) = 1 \cdot (5 + r)
\quad\Rightarrow\quad
4 + 2r = 5 + r
\quad\Rightarrow\quad
r = 1\ \text{Ом}.
$$

Тогда $\mathcal{E} = 2 \cdot 3 = 6\ \text{В}$.

Ответ: $1\ \text{Ом}$.
