/**
 * The fixed "today" this demo dataset is anchored to. The mock ProofPulse
 * epochs (August/September 2026) and expiry dates are all set relative to
 * this date, not the real wall-clock date — otherwise the prototype's
 * derived states (CURRENTLY_ATTESTED vs STALE, EXPIRED vs VERIFIED) would
 * silently change depending on when Review 2 happens to be presented.
 */
export const DEMO_REFERENCE_DATE = "2026-09-10";
