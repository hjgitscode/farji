// Shared helper for producing illustrative bytes32-shaped hex placeholders
// across the mock data files. Not real cryptographic output — see the
// notes in attestations.ts, proofPulseDemo.ts, and cohortDemo.ts.
export const mockHex = (byte: string) => `0x${byte.repeat(32)}`;
export const GENESIS_ROOT = `0x${"0".repeat(64)}`;

/**
 * Deterministic, non-cryptographic placeholder hash used anywhere the UI
 * needs to *look like* a Keccak-256 hash before the real hashing service
 * exists (Phase 4). Same input always produces the same output, purely so
 * a given demo credential/selection shows a stable value across renders.
 */
export function placeholderHex(seed: string): string {
  let value = "";
  for (let i = 0; i < 64; i += 1) {
    const char = seed.charCodeAt(i % seed.length) + i;
    value += (char % 16).toString(16);
  }
  return `0x${value}`;
}
