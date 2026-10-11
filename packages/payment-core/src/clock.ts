export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export function msSince(start: bigint): number {
  return Number((process.hrtime.bigint() - start) / 1_000_000n);
}
export const hrnow = (): bigint => process.hrtime.bigint();
