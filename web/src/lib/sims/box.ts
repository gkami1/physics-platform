// Shared by the molecular models (<pp-gas>, <pp-iso>): an ideal-gas molecule never meets another
// one, so along each axis it moves on a straight line reflected by two walls.

/** Fold an unfolded coordinate into [0, L]: a straight line reflected by two walls. */
export function fold(u: number, l: number): number {
  const m = ((u % (2 * l)) + 2 * l) % (2 * l);
  return m <= l ? m : 2 * l - m;
}
