import type { VerificationState } from "./types";

// Dashboard counts and public grouping derived from REAL derived states (Phase 10). Pure. Nothing is stored or invented:
// every number is a count of records whose state the engine derived.

export type DashboardCounts = {
  total: number;
  /** PERMANENT_VALID, VERIFIED or CURRENTLY_ATTESTED. */
  verified: number;
  currentlyAttested: number;
  pending: number;
  needsRefresh: number;
  selfDeclared: number;
  /** Ended, expired, modified, revoked or failed validation: shown, but not counted as verified. */
  other: number;
};

export function summariseStates(states: readonly VerificationState[]): DashboardCounts {
  const c: DashboardCounts = { total: states.length, verified: 0, currentlyAttested: 0, pending: 0, needsRefresh: 0, selfDeclared: 0, other: 0 };
  for (const s of states) {
    switch (s) {
      case "PERMANENT_VALID":
      case "VERIFIED":
        c.verified++;
        break;
      case "CURRENTLY_ATTESTED":
        c.verified++;
        c.currentlyAttested++;
        break;
      case "PENDING":
        c.pending++;
        break;
      case "STALE_NO_RECENT_ATTESTATION":
        c.needsRefresh++;
        break;
      case "SELF_DECLARED":
        c.selfDeclared++;
        break;
      default:
        c.other++;
    }
  }
  return c;
}

export type PublicGroup = "VERIFIED" | "SELF_DECLARED" | "ATTENTION";

/**
 * Which section of a public profile a record belongs to. Self-declared (and merely pending) records are NEVER grouped
 * with verified ones; revoked, modified or failed-validation records are shown separately so they cannot be mistaken.
 */
export function publicGroupOf(state: VerificationState): PublicGroup {
  switch (state) {
    case "PERMANENT_VALID":
    case "VERIFIED":
    case "CURRENTLY_ATTESTED":
    case "STALE_NO_RECENT_ATTESTATION":
    case "ENDED":
    case "EXPIRED":
      return "VERIFIED";
    case "SELF_DECLARED":
    case "PENDING":
      return "SELF_DECLARED";
    default:
      return "ATTENTION";
  }
}

/** States whose earlier-version note applies when the CURRENT version is not itself verified. */
export const EARLIER_VERIFIED_STATES: readonly VerificationState[] = ["PERMANENT_VALID", "VERIFIED", "CURRENTLY_ATTESTED", "STALE_NO_RECENT_ATTESTATION", "ENDED", "EXPIRED", "MODIFIED"];
