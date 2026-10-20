import { assessPulsePath, deriveContinuing, findValidEnd } from "./continuing";
import { checkSignedMaterial, Collector, keyAtAnchorOutcome, record, successorQualifies, type LifecycleOutcome, type PathAssessment } from "./evidence";
import { deriveExpiring } from "./expiring";
import { assessCohortPath, derivePermanent } from "./permanent";
import type { CredentialEvidence, EvidenceSummary, SignedMaterial, VerificationPolicy, VerificationResult } from "./types";

// The precedence flow of DOMAIN_MODEL §6.1, in the order the specification fixes:
//
//   A  not issuer-signed                                  -> PENDING (credential awaiting signature)
//   B  finalized revocation                               -> REVOKED
//   C  any cryptographic / evidence failure               -> INVALID_PROOF
//   D  superseded by a newer verified attestation         -> MODIFIED
//   E  lifecycle: PERMANENT / CONTINUING / EXPIRING
//
// Each step returns as soon as it decides, so a higher rule can never be overridden by a lower one
// (revocation beats everything; a broken proof beats ENDED / EXPIRED / MODIFIED; ENDED is never REVOKED).

function emptySummary(over: Partial<EvidenceSummary> = {}): EvidenceSummary {
  return {
    signed: false,
    issuedAt: null,
    anchored: false,
    anchoredAt: null,
    anchorEpoch: null,
    attestationType: null,
    latestPulseEpoch: null,
    latestPulseAt: null,
    revoked: false,
    superseded: false,
    ended: false,
    ...over,
  };
}

function finish(
  ev: CredentialEvidence,
  m: SignedMaterial | null,
  c: Collector,
  out: LifecycleOutcome,
  summary: EvidenceSummary,
  extra: { revokedAt?: Date | null } = {},
): VerificationResult {
  return {
    state: out.state,
    lifecycleType: ev.lifecycleType,
    credentialId: m?.credentialId ?? null,
    organisation: ev.organisation,
    evidenceTimestamp: out.evidenceTimestamp ?? null,
    freshnessDeadline: out.freshnessDeadline ?? null,
    expiry: out.expiry ?? null,
    endedAt: out.endedAt ?? null,
    revokedAt: extra.revokedAt ?? null,
    reasons: c.reasons,
    checks: c.checks,
    evidenceSummary: summary,
  };
}

/** B: a revocation counts only when it is FINALIZED, of this organisation, on the configured chain. */
function assessRevocation(ev: CredentialEvidence, m: SignedMaterial, policy: VerificationPolicy, c: Collector): Date | null {
  const r = ev.revocation;
  if (!r) {
    c.check("REVOCATION", "NOT_APPLICABLE", "No revocation is recorded.");
    return null;
  }
  const own = r.organisationId === m.organisationId && r.revokerKeyOrganisationId === m.organisationId;
  const onChain = r.transaction.purpose === "REVOKE_CREDENTIAL" && r.transaction.chainId === Number(policy.domain.chainId);
  if (!own || !onChain) {
    c.check("REVOCATION", "FAIL", "The revocation record is not by this credential's organisation on the configured chain.");
    c.reason("REVOCATION_IGNORED");
    return null;
  }
  if (r.transaction.status !== "FINALIZED") {
    c.check("REVOCATION", "PENDING", "The revocation transaction is not yet finalised.");
    c.reason("REVOCATION_NOT_FINAL");
    return null;
  }
  c.check("REVOCATION", "PASS", "The issuing organisation revoked this credential on-chain.");
  c.reason("REVOKED");
  return r.revokedAt;
}

export function deriveCredentialStateFromEvidence(ev: CredentialEvidence, now: Date, policy: VerificationPolicy): VerificationResult {
  const c = new Collector();
  const m = ev.signed;

  // A. Not issuer-signed. Unsigned work is never INVALID_PROOF, but "signed" with no attestation is missing evidence.
  if (!m) {
    if (ev.workflowSigned) {
      record(c, [{ id: "ATTESTATION_PRESENT", ok: false, detail: "No issuer attestation was found for a credential recorded as signed.", reason: "ATTESTATION_MISSING" }]);
      return finish(ev, null, c, { state: "INVALID_PROOF" }, emptySummary());
    }
    c.check("ATTESTATION_PRESENT", "PENDING", "The organisation has not signed this credential yet.");
    c.reason("AWAITING_SIGNATURE");
    return finish(ev, null, c, { state: "PENDING" }, emptySummary());
  }
  c.check("ATTESTATION_PRESENT", "PASS", "An issuer attestation exists.");
  const base = { signed: true, issuedAt: m.issuedAt };

  // B. Finalized revocation overrides every positive (and every negative) state below.
  const revokedAt = assessRevocation(ev, m, policy, c);
  if (revokedAt) {
    return finish(ev, m, c, { state: "REVOKED", evidenceTimestamp: revokedAt }, emptySummary({ ...base, anchored: null, revoked: true }), { revokedAt });
  }

  // C. Cryptographic and evidence integrity.
  const sigFailures = record(c, checkSignedMaterial(m, policy));
  const path: PathAssessment = ev.lifecycleType === "CONTINUING" ? assessPulsePath(ev, m, policy, c) : assessCohortPath(ev, m, policy, c);
  const anchoredAt = path.status === "OK" ? path.first.blockTimestamp : null;
  const keyFailures = record(c, [keyAtAnchorOutcome(m, anchoredAt, now)]);

  const summary = emptySummary({
    ...base,
    anchored: path.status === "OK",
    anchoredAt,
    anchorEpoch: path.status === "OK" ? path.first.epoch : null,
    attestationType: path.status === "OK" ? path.first.attestationType : null,
    latestPulseEpoch: path.status === "OK" && path.latestActive ? path.latestActive.epoch : null,
    latestPulseAt: path.status === "OK" && path.latestActive ? path.latestActive.blockTimestamp : null,
  });
  if (sigFailures.length > 0 || keyFailures.length > 0 || path.status === "INVALID") {
    return finish(ev, m, c, { state: "INVALID_PROOF" }, { ...summary, anchored: false, anchoredAt: null, anchorEpoch: null, attestationType: null, latestPulseEpoch: null, latestPulseAt: null });
  }

  // D. Superseded by a newer attestation that itself verifies (signature-level; never positive on its own).
  if (ev.successor) {
    if (successorQualifies(ev.successor, { credentialId: m.credentialId, organisationId: m.organisationId, issuedAt: m.issuedAt }, policy)) {
      c.check("SUPERSESSION", "PASS", "A newer version signed by the organisation supersedes this credential.");
      c.reason("SUPERSEDED");
      return finish(ev, m, c, { state: "MODIFIED", evidenceTimestamp: ev.successor.issuedAt }, { ...summary, superseded: true });
    }
    c.check("SUPERSESSION", "FAIL", "A newer version exists but its attestation did not verify.");
    c.reason("SUCCESSOR_IGNORED");
  }

  // E. Lifecycle.
  let out: LifecycleOutcome;
  if (ev.lifecycleType === "PERMANENT") out = derivePermanent(path, m, policy, now, c);
  else if (ev.lifecycleType === "EXPIRING") out = deriveExpiring(path, m, policy, now, c);
  else out = deriveContinuing(path, findValidEnd(ev, m, policy, c), m, policy, now, c);
  return finish(ev, m, c, out, { ...summary, ended: out.state === "ENDED" });
}
