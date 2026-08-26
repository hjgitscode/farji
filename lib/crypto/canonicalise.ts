import type { ClaimType, LifecycleType } from "@/lib/mock-data/types";
import type { CanonicalCredential, CanonicalCredentialInput } from "./types";

const CLAIM_TYPES: readonly ClaimType[] = [
  "DEGREE",
  "EMPLOYMENT",
  "INTERNSHIP",
  "CERTIFICATION",
  "LICENCE",
];

const LIFECYCLE_TYPES: readonly LifecycleType[] = ["PERMANENT", "CONTINUING", "EXPIRING"];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normaliseId(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  return trimmed;
}

// Collapses internal runs of whitespace to a single space and trims the
// ends. Title is free text describing a real credential (a degree name, a
// job title) — it is normalised, not forced into an enum-like shape,
// because doing so would destroy readability for no verification benefit.
function normaliseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normaliseEnum<T extends string>(value: string, allowed: readonly T[], fieldName: string): T {
  const upper = value.trim().toUpperCase() as T;
  if (!allowed.includes(upper)) {
    throw new Error(`Invalid ${fieldName}: "${value}". Expected one of: ${allowed.join(", ")}.`);
  }
  return upper;
}

function normaliseDate(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) {
    throw new Error(`Invalid ${fieldName}: "${value}". Expected an ISO date (YYYY-MM-DD).`);
  }
  return trimmed;
}

function normaliseVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid version: ${value}. Version must be a positive integer.`);
  }
  return value;
}

/**
 * Normalises a raw credential-like object into the exact, deterministic
 * shape that Phase 4 hashes with Keccak-256. Two inputs describing the
 * same credential — regardless of JS key order, extra whitespace, or
 * enum casing — normalise to an identical CanonicalCredential, and will
 * therefore hash to an identical value.
 */
export function canonicaliseCredential(input: CanonicalCredentialInput): CanonicalCredential {
  return {
    credentialId: normaliseId(input.credentialId, "credentialId"),
    candidateRef: normaliseId(input.candidateRef, "candidateRef"),
    claimType: normaliseEnum(input.claimType, CLAIM_TYPES, "claimType"),
    organisationId: normaliseId(input.organisationId, "organisationId"),
    title: normaliseWhitespace(input.title),
    startDate: normaliseDate(input.startDate, "startDate"),
    endDate: input.endDate ? normaliseDate(input.endDate, "endDate") : null,
    lifecycleType: normaliseEnum(input.lifecycleType, LIFECYCLE_TYPES, "lifecycleType"),
    version: normaliseVersion(input.version),
  };
}

/**
 * Serialises a canonical credential to a single deterministic, compact
 * UTF-8 JSON string with a fixed field order. This exact string is what
 * Phase 4 feeds into Keccak-256 — the fixed order is what makes the hash
 * independent of how the caller originally ordered the object's keys.
 */
export function canonicalCredentialToString(credential: CanonicalCredential): string {
  return JSON.stringify({
    credentialId: credential.credentialId,
    candidateRef: credential.candidateRef,
    claimType: credential.claimType,
    organisationId: credential.organisationId,
    title: credential.title,
    startDate: credential.startDate,
    endDate: credential.endDate,
    lifecycleType: credential.lifecycleType,
    version: credential.version,
  });
}

/** Convenience wrapper: normalise then serialise in one call. */
export function canonicalise(input: CanonicalCredentialInput): string {
  return canonicalCredentialToString(canonicaliseCredential(input));
}
