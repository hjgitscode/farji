import { isIsoDate, LIFECYCLE_TYPES, type LifecycleTypeName } from "./claims";

// Pure issuer-review rules (no I/O). Phase 5. See docs/DOMAIN_MODEL.md §3.9, §3.10, §5.

export const REJECTION_REASONS = ["IDENTITY_NOT_MATCHED", "RECORD_NOT_FOUND", "DATES_MISMATCH", "TITLE_MISMATCH", "OTHER"] as const;
export type RejectionReasonName = (typeof REJECTION_REASONS)[number];

export const REJECTION_REASON_LABEL: Record<RejectionReasonName, string> = {
  IDENTITY_NOT_MATCHED: "Identity not matched",
  RECORD_NOT_FOUND: "Record not found",
  DATES_MISMATCH: "Dates do not match",
  TITLE_MISMATCH: "Title does not match",
  OTHER: "Other",
};

const LIMITS = { notes: 2000, sourceOfTruthReference: 500 };

export type ReviewInput = {
  notes: string | null;
  sourceOfTruthReference: string | null;
  rejectionReason: RejectionReasonName | null;
};

export type ReviewValidation = { ok: true; value: ReviewInput } | { ok: false; errors: Record<string, string> };

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Validates an issuer decision form. `notes` and `sourceOfTruthReference` are INTERNAL to the
 * Organisation (never shown to the candidate or publicly). A REJECT needs a reason code; an
 * APPROVE must not carry one (ReviewDecision CHECK). OTHER needs an explanation in the notes.
 */
export function validateReviewInput(decision: "APPROVE" | "REJECT", raw: Record<string, unknown>): ReviewValidation {
  const errors: Record<string, string> = {};
  const notes = clean(raw.notes);
  const sourceOfTruthReference = clean(raw.sourceOfTruthReference);

  if (notes.length > LIMITS.notes) errors.notes = `Notes must be at most ${LIMITS.notes} characters.`;
  if (sourceOfTruthReference.length > LIMITS.sourceOfTruthReference) {
    errors.sourceOfTruthReference = `Reference must be at most ${LIMITS.sourceOfTruthReference} characters.`;
  }

  let rejectionReason: RejectionReasonName | null = null;
  if (decision === "REJECT") {
    const r = clean(raw.rejectionReason);
    if ((REJECTION_REASONS as readonly string[]).includes(r)) rejectionReason = r as RejectionReasonName;
    else errors.rejectionReason = "Choose a rejection reason.";
    if (rejectionReason === "OTHER" && !notes) errors.notes = "Explain the reason in the notes.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { notes: notes || null, sourceOfTruthReference: sourceOfTruthReference || null, rejectionReason } };
}

export type CredentialTerms = { lifecycleType: LifecycleTypeName; validUntil: Date | null };

/**
 * Terms copied from the approved ClaimVersion onto the Credential. The lifecycle type is the
 * version's proposal, made authoritative (and immutable) on the Credential. An EXPIRING
 * Credential carries `validUntil` = the start of the expiry date (UTC), so it is EXPIRED from
 * that date (DOMAIN_MODEL §4). Returns null if the version cannot be issued as it stands.
 */
export function credentialTermsFrom(proposedLifecycleType: string, content: unknown): CredentialTerms | null {
  if (!(LIFECYCLE_TYPES as readonly string[]).includes(proposedLifecycleType)) return null;
  const lifecycleType = proposedLifecycleType as LifecycleTypeName;
  if (lifecycleType !== "EXPIRING") return { lifecycleType, validUntil: null };

  const expiry = content && typeof content === "object" ? (content as Record<string, unknown>).expiryDate : undefined;
  if (typeof expiry !== "string" || !isIsoDate(expiry)) return null;
  return { lifecycleType, validUntil: new Date(`${expiry}T00:00:00.000Z`) };
}
