// Quantities are integer hundredths of a resource unit (master Sections 6.2, 16.5). Population is
// integer milli-units. No floating stock arithmetic exists anywhere in the simulation.

export type Quantity = number;

export const QUANTITY_SCALE = 100;
export const POPULATION_SCALE = 1000;

export class QuantityError extends Error {
  override readonly name = 'QuantityError';
}

export function units(value: number): Quantity {
  return checked(value * QUANTITY_SCALE);
}

export function checked(value: number): number {
  if (!Number.isSafeInteger(value)) throw new QuantityError(`Unsafe or fractional quantity ${value}`);
  return value;
}

export function nonNegative(value: number, label: string): number {
  checked(value);
  if (value < 0) throw new QuantityError(`${label} would become negative (${value})`);
  return value;
}

/** floor(a * b / c) for non-negative integers, guarded against unsafe intermediate products. */
export function mulDivFloor(a: number, b: number, c: number): number {
  const product = checked(a * b);
  if (c <= 0) throw new QuantityError(`mulDivFloor divisor ${c}`);
  return Math.floor(product / c);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Whole units for display; never used to decide rules. */
export function toWholeUnits(quantity: Quantity): number {
  return Math.floor(quantity / QUANTITY_SCALE);
}
