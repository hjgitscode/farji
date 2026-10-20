import { pendingOutcome, type Collector, type LifecycleOutcome, type PathAssessment } from "./evidence";
import type { SignedMaterial, VerificationPolicy } from "./types";

// EXPIRING credentials use the same CohortProof evidence path as PERMANENT ones (permanent.ts). Expiry is
// normal lifecycle behaviour: it is neither invalid evidence nor revocation.
//
// Evidence comes first: an EXPIRING credential must satisfy the same qualifying evidence path as a verified one
// (rule A: no qualifying FINALIZED anchor -> PENDING; rule C: invalid evidence -> INVALID_PROOF) BEFORE its
// lifecycle expiry is evaluated. Only then: now < validUntil -> VERIFIED, now >= validUntil -> EXPIRED.
// EXPIRED is therefore never produced from a signed but not yet sufficiently anchored credential.

export function deriveExpiring(path: PathAssessment, m: SignedMaterial, policy: VerificationPolicy, now: Date, c: Collector): LifecycleOutcome {
  const expiry = m.validUntil;
  if (!expiry) {
    // Unreachable for verified material (CREDENTIAL_DATES requires it); fail closed.
    return { state: "INVALID_PROOF" };
  }
  if (path.status === "NONE") return { ...pendingOutcome(path, m, policy, now, c), expiry };
  if (path.status !== "OK") return { state: "INVALID_PROOF" };
  const evidenceTimestamp = path.first.blockTimestamp;
  if (now.getTime() >= expiry.getTime()) {
    c.check("EXPIRY", "PASS", "The credential has passed its expiry date.");
    c.reason("EXPIRED");
    return { state: "EXPIRED", expiry, evidenceTimestamp };
  }
  c.check("EXPIRY", "PASS", "The credential has not yet expired.");
  c.reason("VALID_EXPIRING");
  return { state: "VERIFIED", expiry, evidenceTimestamp };
}
