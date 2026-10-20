import type { VerificationResult } from "./types";

// Display labels for derived states (DOMAIN_MODEL §6.3). Pure text only; the visual treatment is Phase 11-13.

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The default label of a derived state. */
export function stateLabel(r: VerificationResult): string {
  const org = r.organisation?.displayName ?? "the organisation";
  switch (r.state) {
    case "SELF_DECLARED":
      return "Self-declared";
    case "PENDING":
      return "Verification pending";
    case "VERIFIED":
      return r.expiry ? `Verified · valid until ${day(r.expiry)}` : "Verified";
    case "PERMANENT_VALID":
      return "Verified";
    case "CURRENTLY_ATTESTED":
      return `Verified · currently confirmed by ${org}`;
    case "STALE_NO_RECENT_ATTESTATION":
      return `Not recently confirmed by ${org}`;
    case "EXPIRED":
      return r.expiry ? `Expired ${day(r.expiry)}` : "Expired";
    case "ENDED":
      return r.endedAt ? `Verified · ended ${day(r.endedAt)}` : "Verified · ended";
    case "REVOKED":
      return `Revoked by ${org}`;
    case "MODIFIED":
      return "Superseded by a newer verified version";
    case "INVALID_PROOF":
      return "Verification failed";
  }
}

/** Lifecycle-specific timing lines: freshness deadline, expiry, end date. */
export function timingLines(r: VerificationResult): string[] {
  const lines: string[] = [];
  if (r.state === "CURRENTLY_ATTESTED" && r.freshnessDeadline) lines.push(`Confirmed again by ${day(r.freshnessDeadline)} to stay current.`);
  if (r.state === "STALE_NO_RECENT_ATTESTATION" && r.freshnessDeadline) lines.push(`Last confirmation lapsed on ${day(r.freshnessDeadline)}.`);
  if (r.expiry && r.state !== "VERIFIED" && r.state !== "EXPIRED") lines.push(`Credential expires ${day(r.expiry)}.`);
  if (r.state === "ENDED" && r.endedAt) lines.push(`Relationship ended ${day(r.endedAt)}.`);
  if (r.state === "REVOKED" && r.revokedAt) lines.push(`Revoked ${day(r.revokedAt)}.`);
  return lines;
}
