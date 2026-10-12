// Pure claim-content validation (no I/O; `now` is passed in). Implements the lifecycle
// rules of docs/DOMAIN_MODEL.md §4 for what a CANDIDATE may propose. The lifecycle type
// entered here is only a proposal (ClaimVersion.proposedLifecycleType); the authoritative
// type is fixed later on the issued Credential.

export const CLAIM_CATEGORIES = ["EXPERIENCE", "EDUCATION", "CERTIFICATION", "MEMBERSHIP"] as const;
export const LIFECYCLE_TYPES = ["PERMANENT", "CONTINUING", "EXPIRING"] as const;

export type ClaimCategoryName = (typeof CLAIM_CATEGORIES)[number];
export type LifecycleTypeName = (typeof LIFECYCLE_TYPES)[number];

/** Content stored in ClaimVersion.content. Dates are ISO calendar dates (YYYY-MM-DD). */
export type ClaimContent = {
  title: string;
  organisationName: string;
  startDate: string;
  endDate?: string;
  expiryDate?: string;
  description?: string;
  location?: string;
  fieldOfStudy?: string; // EDUCATION only
  credentialNumber?: string; // CERTIFICATION only
};

export type ValidatedClaimDraft = {
  category: ClaimCategoryName;
  lifecycleType: LifecycleTypeName;
  content: ClaimContent;
};

export type ClaimValidation =
  | { ok: true; value: ValidatedClaimDraft }
  | { ok: false; errors: Record<string, string> };

const LIMITS = { title: 200, organisationName: 200, description: 2000, location: 200, fieldOfStudy: 200, credentialNumber: 100 };

function str(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === "string" ? v.trim() : "";
}

/** True for a real calendar date in strict YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const todayIso = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Validates a raw draft. Only the allowlisted keys below are ever read, so hidden or
 * extra form fields (userId, role, organisationId, …) can never reach stored content.
 * `fixedCategory` is used when editing: a claim's category never changes.
 */
export function validateClaimDraft(raw: Record<string, unknown>, now: Date, fixedCategory?: ClaimCategoryName): ClaimValidation {
  const errors: Record<string, string> = {};

  const categoryRaw = fixedCategory ?? str(raw, "category");
  const category = (CLAIM_CATEGORIES as readonly string[]).includes(categoryRaw) ? (categoryRaw as ClaimCategoryName) : null;
  if (!category) errors.category = "Choose a valid category.";

  const lifecycleRaw = str(raw, "lifecycleType");
  const lifecycleType = (LIFECYCLE_TYPES as readonly string[]).includes(lifecycleRaw) ? (lifecycleRaw as LifecycleTypeName) : null;
  if (!lifecycleType) errors.lifecycleType = "Choose a valid lifecycle type.";

  const required = (key: "title" | "organisationName", label: string) => {
    const v = str(raw, key);
    if (!v) errors[key] = `${label} is required.`;
    else if (v.length > LIMITS[key]) errors[key] = `${label} must be at most ${LIMITS[key]} characters.`;
    return v;
  };
  const optional = (key: "description" | "location" | "fieldOfStudy" | "credentialNumber", label: string) => {
    const v = str(raw, key);
    if (v.length > LIMITS[key]) errors[key] = `${label} must be at most ${LIMITS[key]} characters.`;
    return v || undefined;
  };

  const title = required("title", "Title");
  const organisationName = required("organisationName", "Organisation");
  const description = optional("description", "Description");
  const location = optional("location", "Location");
  const fieldOfStudy = category === "EDUCATION" ? optional("fieldOfStudy", "Field of study") : undefined;
  const credentialNumber = category === "CERTIFICATION" ? optional("credentialNumber", "Credential number") : undefined;

  const today = todayIso(now);
  const startDate = str(raw, "startDate");
  const endDate = str(raw, "endDate");
  const expiryDate = str(raw, "expiryDate");

  const dateOk = (key: "startDate" | "endDate" | "expiryDate", value: string, label: string) => {
    if (!isIsoDate(value)) {
      errors[key] = `${label} must be a valid date.`;
      return false;
    }
    return true;
  };

  const startValid = !startDate ? ((errors.startDate = "Start date is required."), false) : dateOk("startDate", startDate, "Start date");
  if (startValid && startDate > today) errors.startDate = "Start date cannot be in the future.";

  if (lifecycleType === "PERMANENT") {
    // A completed historical fact: it is NOT treated as currently active, so it needs an end date
    // (except a certification that simply never lapses).
    if (!endDate) {
      if (category !== "CERTIFICATION") errors.endDate = "A completed (permanent) record needs an end date.";
    } else if (dateOk("endDate", endDate, "End date")) {
      if (startValid && endDate < startDate) errors.endDate = "End date cannot be before the start date.";
      else if (endDate > today) errors.endDate = "A completed record cannot end in the future.";
    }
    if (expiryDate) errors.expiryDate = "Only an expiring record has an expiry date.";
  } else if (lifecycleType === "CONTINUING") {
    // Current employment / enrolment / membership: not forced to have an end date, and has none.
    // Ending the relationship is recorded by the organisation, never by the candidate.
    if (endDate) errors.endDate = "A current record has no end date. The organisation records when it ends.";
    if (expiryDate) errors.expiryDate = "Only an expiring record has an expiry date.";
  } else if (lifecycleType === "EXPIRING") {
    if (!expiryDate) errors.expiryDate = "An expiring record needs an expiry date.";
    else if (dateOk("expiryDate", expiryDate, "Expiry date") && startValid && expiryDate <= startDate) {
      errors.expiryDate = "Expiry date must be after the start date.";
    }
    if (endDate) errors.endDate = "An expiring record uses an expiry date, not an end date.";
  }

  if (Object.keys(errors).length > 0 || !category || !lifecycleType) return { ok: false, errors };

  const content: ClaimContent = { title, organisationName, startDate };
  if (lifecycleType === "PERMANENT" && endDate) content.endDate = endDate;
  if (lifecycleType === "EXPIRING") content.expiryDate = expiryDate;
  if (description) content.description = description;
  if (location) content.location = location;
  if (fieldOfStudy) content.fieldOfStudy = fieldOfStudy;
  if (credentialNumber) content.credentialNumber = credentialNumber;
  return { ok: true, value: { category, lifecycleType, content } };
}

/** Reads stored ClaimVersion.content defensively for display (never trusted as typed). */
export function readContent(value: unknown): Partial<Record<keyof ClaimContent, string>> {
  const out: Partial<Record<keyof ClaimContent, string>> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") out[k as keyof ClaimContent] = v;
    }
  }
  return out;
}

/** Operational workflow status labels. These are NOT verification states (Phase 10). */
export const REQUEST_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  SUPERSEDED: "Superseded by a newer version",
};

/** Order-independent comparison, used to avoid creating a version for an unchanged edit. */
export function sameDraft(a: { lifecycleType: string; content: unknown }, b: { lifecycleType: string; content: unknown }): boolean {
  const canon = (x: unknown): string =>
    JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([p], [q]) => p.localeCompare(q))) : v));
  return a.lifecycleType === b.lifecycleType && canon(a.content) === canon(b.content);
}
