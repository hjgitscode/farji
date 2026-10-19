// Issuer-key validity (DOMAIN_MODEL §3.5, BLOCKCHAIN_MODEL §7). Pure; time is always passed in.
//
// A wallet has exactly ONE validity period [validFrom, validUntil) and an optional compromise
// time. It is never re-authorised. Retiring a key later never invalidates a signature made while
// it was valid: historical validity is judged at the signed `issuedAt`, not at "now".

export type IssuerKeyHistory = {
  validFrom: Date;
  validUntil: Date | null;
  compromisedAt: Date | null;
};

/** Was the wallet authorised for its Organisation at instant `t`? validFrom <= t < validUntil. */
export function isKeyAuthorisedAt(key: IssuerKeyHistory, t: Date): boolean {
  const ms = t.getTime();
  return key.validFrom.getTime() <= ms && (key.validUntil === null || ms < key.validUntil.getTime());
}

/** Had the wallet been marked compromised at or before instant `t`? */
export function isKeyCompromisedAt(key: IssuerKeyHistory, t: Date): boolean {
  return key.compromisedAt !== null && key.compromisedAt.getTime() <= t.getTime();
}

export type KeyDenial =
  | "NOT_AUTHORISED_AT_ISSUANCE"
  | "NOT_CURRENTLY_AUTHORISED"
  | "COMPROMISED";

/**
 * May this wallet be used to ACCEPT a NEW attestation now? It must have been authorised at the
 * signed `issuedAt` AND still be open now, and must not be compromised at all. (A retired key
 * cannot be used for new attestations; its old attestations stay valid.)
 */
export function checkKeyForNewAttestation(key: IssuerKeyHistory, issuedAt: Date, now: Date): KeyDenial | null {
  if (key.compromisedAt !== null) return "COMPROMISED";
  if (!isKeyAuthorisedAt(key, issuedAt)) return "NOT_AUTHORISED_AT_ISSUANCE";
  if (!isKeyAuthorisedAt(key, now)) return "NOT_CURRENTLY_AUTHORISED";
  return null;
}

/**
 * Historical check used when re-evaluating stored evidence: was the signature made by a key that
 * was authorised at `issuedAt` and not yet compromised then? Later retirement is irrelevant.
 */
export function wasKeyValidForAttestation(key: IssuerKeyHistory, issuedAt: Date): boolean {
  return isKeyAuthorisedAt(key, issuedAt) && !isKeyCompromisedAt(key, issuedAt);
}
