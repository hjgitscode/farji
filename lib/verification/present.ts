import { formatDate } from "@/lib/format";
import type { VerificationResult, VerificationState } from "./types";

// How a DERIVED state is described to people (ROADMAP Phase 11-13). Pure text and a tone token: the state itself
// always comes from the Phase 10 engine; nothing here decides, stores or upgrades a verification. Technical terms
// (hashes, Merkle, EIP-712, contracts) never appear here; they live behind "View verification details".

export type Tone = "verified" | "current" | "attention" | "pending" | "neutral" | "danger" | "muted";
export type Audience = "owner" | "public";

export type StatePresentation = {
  state: VerificationState;
  tone: Tone;
  /** Short badge text. */
  badge: string;
  /** The sentence shown on a record card. */
  headline: string;
  /** One concise sentence of explanation. */
  explanation: string;
  /** A glyph for non-colour cues. */
  icon: "✓" | "●" | "!" | "○" | "×" | "…";
};

const org = (r: VerificationResult) => r.organisation?.displayName ?? "the organisation";

export function presentState(r: VerificationResult, audience: Audience = "owner"): StatePresentation {
  const base = { state: r.state };
  switch (r.state) {
    case "PERMANENT_VALID":
      return { ...base, tone: "verified", badge: "Verified", icon: "✓", headline: "Verified historical credential", explanation: `${org(r)} confirmed this from its own records and the evidence is on a public record that cannot be altered.` };
    case "CURRENTLY_ATTESTED":
      return { ...base, tone: "current", badge: "Currently confirmed", icon: "✓", headline: `Currently confirmed by ${org(r)}`, explanation: `${org(r)} has recently re-confirmed that this is still current${r.freshnessDeadline ? `; the confirmation is fresh until ${formatDate(r.freshnessDeadline)}` : ""}.` };
    case "STALE_NO_RECENT_ATTESTATION":
      return { ...base, tone: "attention", badge: "Needs refresh", icon: "!", headline: `Last confirmed on ${formatDate(r.evidenceTimestamp)} · needs refresh`, explanation: `${org(r)} confirmed this earlier but has not re-confirmed it recently, so it cannot be shown as current.` };
    case "VERIFIED":
      return { ...base, tone: "verified", badge: "Verified", icon: "✓", headline: `Verified until ${formatDate(r.expiry)}`, explanation: `${org(r)} confirmed this credential, which is valid until its expiry date.` };
    case "EXPIRED":
      return { ...base, tone: "muted", badge: "Expired", icon: "○", headline: `Expired on ${formatDate(r.expiry)}`, explanation: "This credential was genuine but has passed its expiry date. Expiry is not a revocation." };
    case "ENDED":
      return { ...base, tone: "muted", badge: "Ended", icon: "○", headline: `Relationship ended on ${formatDate(r.endedAt)}`, explanation: `${org(r)} recorded that this relationship has ended. It was genuine for the period it covered; ending is not a revocation.` };
    case "REVOKED":
      return { ...base, tone: "danger", badge: "Revoked", icon: "×", headline: "Credential revoked", explanation: `${org(r)} withdrew this credential${r.revokedAt ? ` on ${formatDate(r.revokedAt)}` : ""}. It should no longer be relied upon.` };
    case "MODIFIED":
      return { ...base, tone: "muted", badge: "Modified", icon: "○", headline: "A newer verified record replaces this version", explanation: "The record was updated after this version was issued. See the current version for the latest information." };
    case "PENDING":
      return { ...base, tone: "pending", badge: "Pending", icon: "…", headline: "Verification in progress", explanation: "The organisation is still working on this record, or its confirmation is not final yet. Nothing is shown as verified until it is." };
    case "SELF_DECLARED":
      return audience === "public"
        ? { ...base, tone: "neutral", badge: "Self-declared", icon: "○", headline: "Self-declared · not verified", explanation: "The profile owner added this record. No organisation has verified it." }
        : { ...base, tone: "neutral", badge: "Self-declared", icon: "○", headline: "Added by you · not yet verified", explanation: "Only you have vouched for this record. Request verification so the organisation can confirm it." };
    case "INVALID_PROOF":
      return { ...base, tone: "danger", badge: "Could not be validated", icon: "!", headline: "Verification evidence could not be validated", explanation: "The evidence behind this record did not pass FARJI's checks, so it is not shown as verified." };
  }
}

/** States that count as "verified" on a dashboard. */
export const VERIFIED_STATES: readonly VerificationState[] = ["PERMANENT_VALID", "VERIFIED", "CURRENTLY_ATTESTED"];
export const isVerifiedState = (s: VerificationState) => VERIFIED_STATES.includes(s);
