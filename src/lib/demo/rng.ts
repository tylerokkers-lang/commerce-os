/**
 * Deterministic pseudo-random numbers for demo data.
 *
 * Demo figures must be stable: a dashboard whose revenue changes on every
 * refresh is useless for evaluating the system, and impossible to write tests
 * against. Same seed, same business, every time.
 */
export function createRng(seed: number) {
  // mulberry32 - small, fast, good enough distribution for illustrative data.
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    /** Integer in [min, max] inclusive. */
    int: (min: number, max: number): number => Math.floor(next() * (max - min + 1)) + min,
    /** Float in [min, max). */
    float: (min: number, max: number): number => next() * (max - min) + min,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    /** True with the given probability. */
    chance: (probability: number): boolean => next() < probability,
  }
}

export type Rng = ReturnType<typeof createRng>
