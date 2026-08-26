import type { ClaimType, LifecycleType } from "@/lib/mock-data/types";

/**
 * Raw input to canonicalisation. Deliberately loose: field values may
 * arrive with inconsistent casing or extra whitespace (e.g. typed by a
 * candidate, or read from an external ERP export) — canonicalisation's
 * job is to normalise that away before anything gets hashed.
 */
export interface CanonicalCredentialInput {
  credentialId: string;
  candidateRef: string;
  claimType: string;
  organisationId: string;
  title: string;
  startDate: string;
  endDate?: string | null;
  lifecycleType: string;
  version: number;
}

/**
 * The normalised, exact shape that gets serialised and hashed. Two
 * different CanonicalCredentialInput values that describe the same real
 * credential always normalise to an identical CanonicalCredential.
 */
export interface CanonicalCredential {
  credentialId: string;
  candidateRef: string;
  claimType: ClaimType;
  organisationId: string;
  title: string;
  startDate: string;
  endDate: string | null;
  lifecycleType: LifecycleType;
  version: number;
}
