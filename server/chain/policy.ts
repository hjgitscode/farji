// Chain-related business policy passed to the services (ROADMAP D7 / D17). Nothing here is read by
// the pure engines; the Phase 10 verification engine takes the same values as inputs.

/** D7: a signed attestation must be anchored within this long of its `issuedAt`. */
export const MAX_ANCHOR_DELAY_SECONDS = 30 * 24 * 3600;

/** Warn the issuer when a queued attestation is this old and still unanchored. */
export const ANCHOR_WARNING_SECONDS = 21 * 24 * 3600;

/** A PENDING transaction unknown to the node, with no consumed nonce, is given up after this long. */
export const PENDING_GIVE_UP_MS = 24 * 3600 * 1000;
