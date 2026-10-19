import { pulseNodeHash, zeroHashes } from "@/lib/merkle/pulse";

/**
 * From-scratch reference root of a fixed-depth positional tree. It exists ONLY in tests: the
 * product never rebuilds a ProofPulse tree. Used to prove the incremental path updates equal a
 * full recomputation.
 */
export function referencePulseRoot(depth: number, leaves: Map<number, string>): string {
  const zero = zeroHashes(depth);
  const anyIn = (lo: number, hi: number) => [...leaves.keys()].some((k) => k >= lo && k < hi);
  const rec = (level: number, position: number): string => {
    const lo = position * 2 ** level;
    const hi = lo + 2 ** level;
    if (!anyIn(lo, hi)) return zero[level];
    if (level === 0) return leaves.get(position) as string;
    return pulseNodeHash(rec(level - 1, 2 * position), rec(level - 1, 2 * position + 1));
  };
  return rec(depth, 0);
}

/** Small seeded PRNG so property tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
