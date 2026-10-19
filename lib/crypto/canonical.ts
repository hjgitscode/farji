import { isIsoDate } from "@/lib/core/claims";
import { CATEGORY_CODE, type CategoryName, type LifecycleName } from "./constants";

// Canonical credential content (ROADMAP D39/D40). JSON is NEVER hashed: the canonical form is a
// fixed list of string fields that EIP-712 `hashStruct` encodes by position and type, so key
// order, whitespace and JSON.stringify behaviour cannot affect any hash. This module only
// normalises and validates field VALUES. It is total, deterministic and fails closed.
//
// It is structural only (no clock), so the same stored content re-validates identically years later.

/** The nine content keys, in canonical order. Any other stored key makes the content invalid. */
export const CONTENT_KEYS = [
  "title",
  "organisationName",
  "startDate",
  "endDate",
  "expiryDate",
  "description",
  "location",
  "fieldOfStudy",
  "credentialNumber",
] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

/** Canonical content before salting: `category` code plus nine strings ("" when absent). */
export type CanonicalContent = { category: number } & Record<ContentKey, string>;

export type CanonicalResult = { ok: true; value: CanonicalContent } | { ok: false; errors: Record<string, string> };

const MAX_LENGTH = 4000;
// C0 and C1 control characters, DEL. (\t and \n are additionally rejected except inside `description`.)
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

function normaliseString(raw: string, key: ContentKey): { value: string } | { error: string } {
  if (!raw.isWellFormed()) return { error: "contains invalid Unicode" };
  const value = raw.normalize("NFC").replace(/\r\n|\r/g, "\n").trim();
  if (CONTROL.test(value)) return { error: "contains control characters" };
  if (key !== "description" && /[\t\n]/.test(value)) return { error: "must be a single line" };
  if (value.length > MAX_LENGTH) return { error: `must be at most ${MAX_LENGTH} characters` };
  return { value };
}

export function canonicalCredentialContent(category: CategoryName, lifecycleType: LifecycleName, content: unknown): CanonicalResult {
  const errors: Record<string, string> = {};
  if (!(category in CATEGORY_CODE)) errors.category = "unknown category";

  if (content === null || typeof content !== "object" || Array.isArray(content)) {
    return { ok: false, errors: { ...errors, content: "content must be an object" } };
  }
  const raw = content as Record<string, unknown>;

  // Unknown keys would be displayed but not covered by the digest: reject, never ignore.
  for (const key of Object.keys(raw)) {
    if (!(CONTENT_KEYS as readonly string[]).includes(key)) errors[key] = "unknown field";
  }

  const out = {} as Record<ContentKey, string>;
  for (const key of CONTENT_KEYS) {
    const v = raw[key];
    if (v === undefined || v === null) {
      out[key] = "";
    } else if (typeof v !== "string") {
      errors[key] = "must be a string";
      out[key] = "";
    } else {
      const n = normaliseString(v, key);
      if ("error" in n) {
        errors[key] = n.error;
        out[key] = "";
      } else {
        out[key] = n.value;
      }
    }
  }

  for (const key of ["title", "organisationName", "startDate"] as const) {
    if (!out[key] && !errors[key]) errors[key] = "is required";
  }
  for (const key of ["startDate", "endDate", "expiryDate"] as const) {
    if (out[key] && !errors[key] && !isIsoDate(out[key])) errors[key] = "must be a valid YYYY-MM-DD date";
  }

  // Lifecycle- and category-specific fields.
  if (out.endDate && lifecycleType !== "PERMANENT") errors.endDate = "only a PERMANENT record has an end date";
  if (lifecycleType === "EXPIRING") {
    if (!out.expiryDate && !errors.expiryDate) errors.expiryDate = "is required for an EXPIRING record";
  } else if (out.expiryDate) {
    errors.expiryDate = "only an EXPIRING record has an expiry date";
  }
  if (out.fieldOfStudy && category !== "EDUCATION") errors.fieldOfStudy = "only an EDUCATION record has a field of study";
  if (out.credentialNumber && category !== "CERTIFICATION") errors.credentialNumber = "only a CERTIFICATION record has a credential number";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { category: CATEGORY_CODE[category], ...out } };
}
