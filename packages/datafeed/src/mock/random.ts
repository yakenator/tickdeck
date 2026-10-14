// Deterministic pseudo-random helpers built on 32-bit integer math only, so a
// given seed produces the same numbers in every JavaScript engine.

function finalize(value: number): number {
  let h = value;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hashes a list of integers into an unsigned 32-bit value. */
export function hash32(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) h = finalize(Math.imul(h ^ (value | 0), 0x01000193) + 0x9e3779b9);
  return h;
}

export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return finalize(h);
}

/** Maps a 32-bit hash to [0, 1). */
export function unitFloat(hash: number): number {
  return hash / 4_294_967_296;
}

/** Mulberry32 generator returning floats in [0, 1). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const SQRT3 = 1.7320508075688772;

/** Approximately standard normal (Irwin-Hall with four terms), bounded to about ±3.46. */
export function normal(random: () => number): number {
  return (random() + random() + random() + random() - 2) * SQRT3;
}
