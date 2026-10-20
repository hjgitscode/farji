import { canonicalCredentialContent } from "@/lib/crypto/canonical";
import { chainRootOf } from "@/lib/crypto/chain-root";
import { contentDigestOf, credentialIdOf, subjectCommitmentOf } from "@/lib/crypto/commitments";
import { LIFECYCLE_CODE, ZERO_HASH, type AttestationTypeName } from "@/lib/crypto/constants";
import { buildCredentialTypedData, buildStatusChangeTypedData, farjiDomain, recoverSigner, typedDataHash } from "@/lib/crypto/eip712";
import { dateToUnixSeconds, isoDateToUnixSeconds, uuidToBytes16 } from "@/lib/crypto/encoding";
import { isKeyAuthorisedAt, isKeyCompromisedAt, wasKeyValidForEvidence } from "@/lib/crypto/keys";
import type {
  AnchorEvidence,
  AttestationEvidence,
  CheckId,
  CheckStatus,
  ReasonCode,
  SignedMaterial,
  VerificationCheck,
  VerificationPolicy,
  VerificationReason,
  VerificationState,
} from "./types";

// Evidence validation primitives (ROADMAP Phase 10). Pure. Everything is recomputed from raw rows with
// the Phase 6-8 helpers; nothing here reads a stored verdict.

const REASON_MESSAGE: Record<ReasonCode, string> = {
  NO_REQUEST: "This record has not been verified by any organisation.",
  REQUEST_IN_PROGRESS: "A verification request is in progress.",
  AWAITING_SIGNATURE: "The organisation has approved this record but has not yet signed it.",
  AWAITING_ANCHOR: "Signed by the organisation; waiting for the on-chain anchor to be finalised.",
  ANCHOR_NOT_FINAL: "The on-chain anchor has been seen but is not yet final.",
  ANCHOR_CHAIN_INCOMPLETE: "Earlier anchors of the organisation's chain have not been synchronised yet.",
  ANCHOR_WINDOW_ELAPSED: "The permitted anchoring window has passed without a qualifying anchor.",
  REVOKED: "The issuing organisation revoked this credential.",
  SUPERSEDED: "The issuing organisation has since signed a newer version of this record.",
  ENDED: "The issuing organisation recorded that this relationship has ended.",
  EXPIRED: "This credential has passed its expiry date.",
  STALE: "The organisation has not recently re-confirmed this relationship.",
  ATTESTATION_MISSING: "The credential is marked as signed but no valid issuer attestation was found.",
  SIGNED_MATERIAL_MISMATCH: "The signed credential content does not match the recorded evidence.",
  SIGNATURE_INVALID: "The issuer's signature could not be verified.",
  SIGNER_NOT_AUTHORISED: "The signing wallet was not authorised for this organisation when it signed.",
  SIGNER_AUTHORISATION_NOT_FINAL: "The signing wallet's authorisation is not finalised on-chain.",
  SIGNER_ORGANISATION_MISMATCH: "The signing wallet belongs to a different organisation.",
  SIGNER_COMPROMISED: "The signing wallet was reported compromised before this evidence was anchored.",
  MERKLE_PROOF_INVALID: "The inclusion proof does not verify against the anchored root.",
  ANCHOR_ORGANISATION_MISMATCH: "The anchor belongs to a different organisation.",
  ANCHOR_CHAIN_MISMATCH: "The anchor was not recorded on the expected chain or contract.",
  ANCHOR_ROOT_MISMATCH: "The anchored root does not match the recorded tree.",
  ANCHOR_CHAIN_BROKEN: "The organisation's anchor chain is inconsistent.",
  ANCHOR_TOO_LATE: "The evidence was anchored later than the permitted window after signing.",
  ANCHOR_BEFORE_ISSUANCE: "The anchor predates the signature it is meant to cover.",
  PULSE_HISTORY_INCONSISTENT: "The organisation's current-state history is inconsistent.",
  REVOCATION_NOT_FINAL: "A revocation record exists but is not finalised on-chain and was not applied.",
  REVOCATION_IGNORED: "A revocation record from another organisation was ignored.",
  STATUS_CHANGE_IGNORED: "A recorded status change failed verification and was ignored.",
  SUCCESSOR_IGNORED: "A newer version exists but its attestation failed verification, so it was not applied.",
  VALID_PERMANENT: "Signed by the issuing organisation and anchored on-chain within the permitted window.",
  VALID_EXPIRING: "Signed by the issuing organisation and anchored on-chain; it has not yet expired.",
  CURRENT_PULSE: "The issuing organisation recently re-confirmed this relationship on-chain.",
};

/** Accumulates the check list and human-readable reasons while a state is derived. */
export class Collector {
  readonly checks: VerificationCheck[] = [];
  readonly reasons: VerificationReason[] = [];

  check(id: CheckId, status: CheckStatus, detail: string): void {
    this.checks.push({ id, status, detail });
  }

  reason(code: ReasonCode): void {
    if (!this.reasons.some((r) => r.code === code)) this.reasons.push({ code, message: REASON_MESSAGE[code] });
  }
}

/** A failed check carries the reason it maps to. */
export type CheckOutcome = { id: CheckId; ok: boolean; detail: string; reason: ReasonCode };

/** Records outcomes; returns the failing ones. */
export function record(c: Collector, outcomes: CheckOutcome[]): CheckOutcome[] {
  const failed: CheckOutcome[] = [];
  for (const o of outcomes) {
    c.check(o.id, o.ok ? "PASS" : "FAIL", o.detail);
    if (!o.ok) {
      c.reason(o.reason);
      failed.push(o);
    }
  }
  return failed;
}

function attempt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

const secs = (d: Date) => dateToUnixSeconds(d);

// ───────────────────────────── credential signature ─────────────────────────────

/**
 * Recomputes a credential's signed message from stored material and checks every link between the
 * stored evidence and the signature: identifiers, canonical content, digest, subject commitment, dates,
 * EIP-712 hash, recovered signer, signer organisation, key period and the finalised key authorisation.
 *
 * It does NOT judge compromise: that depends on when the evidence was anchored (`keyAtAnchorOutcome`).
 */
export function checkSignedMaterial(m: SignedMaterial, policy: VerificationPolicy): CheckOutcome[] {
  const out: CheckOutcome[] = [];
  const add = (id: CheckId, ok: boolean, detail: string, reason: ReasonCode) => out.push({ id, ok, detail, reason });
  const att = m.attestation;
  const key = att.signerKey;

  add(
    "SIGNER_ORGANISATION",
    att.organisationId === m.organisationId && key.organisationId === m.organisationId,
    "The signing wallet and attestation belong to the issuing organisation.",
    "SIGNER_ORGANISATION_MISMATCH",
  );
  add(
    "CREDENTIAL_ID",
    attempt(() => credentialIdOf(m.orgId, m.credentialSalt) === m.credentialId) === true,
    "The credential identifier derives from the organisation and the credential salt.",
    "SIGNED_MATERIAL_MISMATCH",
  );

  const canonical = attempt(() => canonicalCredentialContent(m.category, m.lifecycleType, m.claimContent));
  const content = canonical && canonical.ok ? canonical.value : null;
  add("CANONICAL_CONTENT", content !== null, "The record content is canonical.", "SIGNED_MATERIAL_MISMATCH");

  if (content) {
    add(
      "CONTENT_DIGEST",
      attempt(() => contentDigestOf(content, m.contentSalt) === m.contentDigest) === true,
      "The content digest matches the record content.",
      "SIGNED_MATERIAL_MISMATCH",
    );
    add(
      "SUBJECT_COMMITMENT",
      attempt(() => subjectCommitmentOf(uuidToBytes16(m.candidateId), m.subjectSalt) === m.subjectCommitment) === true,
      "The subject commitment matches the candidate.",
      "SIGNED_MATERIAL_MISMATCH",
    );
    const datesOk =
      attempt(() => {
        if (secs(m.validFrom) !== isoDateToUnixSeconds(content.startDate)) return false;
        if (m.lifecycleType === "EXPIRING") return m.validUntil !== null && secs(m.validUntil) === isoDateToUnixSeconds(content.expiryDate);
        return m.validUntil === null;
      }) === true;
    add("CREDENTIAL_DATES", datesOk, "The start and expiry dates match the signed content.", "SIGNED_MATERIAL_MISMATCH");

    const typed = attempt(() =>
      buildCredentialTypedData(farjiDomain(policy.domain), {
        credentialId: m.credentialId,
        orgId: m.orgId,
        subjectCommitment: m.subjectCommitment,
        content,
        contentSalt: m.contentSalt,
        lifecycleType: LIFECYCLE_CODE[m.lifecycleType],
        validFrom: secs(m.validFrom),
        validUntil: m.validUntil ? secs(m.validUntil) : 0n,
        supersedesCredentialId: m.supersedesCredentialId,
        issuedAt: secs(m.issuedAt),
        nonce: att.nonce,
      }),
    );
    const hashOk = typed !== null && attempt(() => typedDataHash(typed)) === att.typedDataHash;
    add(
      "SIGNED_MESSAGE",
      hashOk && att.chainId === Number(policy.domain.chainId) && att.verifyingContract === policy.domain.verifyingContract && att.issuedAt.getTime() === m.issuedAt.getTime(),
      "The signed message equals the one rebuilt from the record, under the configured chain and registry.",
      "SIGNED_MATERIAL_MISMATCH",
    );
    add(
      "SIGNATURE",
      typed !== null && recoverSigner(typed, att.signature) === key.walletAddress,
      "The signature recovers to the recorded issuer wallet.",
      "SIGNATURE_INVALID",
    );
  } else {
    add("SIGNED_MESSAGE", false, "The signed message could not be rebuilt.", "SIGNED_MATERIAL_MISMATCH");
    add("SIGNATURE", false, "The signature could not be checked.", "SIGNATURE_INVALID");
  }

  add(
    "SIGNER_AUTHORISED_AT_ISSUANCE",
    isKeyAuthorisedAt(key, m.issuedAt),
    "The wallet was authorised for the organisation at the signed issuance time.",
    "SIGNER_NOT_AUTHORISED",
  );
  add("SIGNER_AUTHORISATION_FINAL", key.authorisationFinalized, "The wallet's authorisation transaction is finalised.", "SIGNER_AUTHORISATION_NOT_FINAL");
  return out;
}

/**
 * Compromise at ANCHOR time (BLOCKCHAIN_MODEL §7, the twin of `FarjiRegistry.isEvidenceKeyValid`): the
 * evidence stands only if it was anchored before the key was marked compromised. A later retirement is
 * irrelevant. Evidence not yet anchored is judged as if anchored `now`: any future anchor is at least
 * that late, so a key already compromised can never produce qualifying evidence.
 */
export function keyAtAnchorOutcome(m: SignedMaterial, anchoredAt: Date | null, now: Date): CheckOutcome {
  const at = anchoredAt ?? now;
  const ok = wasKeyValidForEvidence(m.attestation.signerKey, m.issuedAt, at);
  return {
    id: "SIGNER_NOT_COMPROMISED_AT_ANCHOR",
    ok,
    detail: anchoredAt ? "The wallet was not compromised when the evidence was anchored." : "The wallet is not compromised, so the evidence can still qualify.",
    reason: "SIGNER_COMPROMISED",
  };
}

/** Signature-level validity of a would-be successor (no anchor needed: supersession is never positive). */
export function successorQualifies(
  successor: SignedMaterial,
  predecessor: { credentialId: string; organisationId: string; issuedAt: Date },
  policy: VerificationPolicy,
): boolean {
  if (successor.organisationId !== predecessor.organisationId) return false;
  // The signed message must name THIS credential as its predecessor.
  if (successor.supersedesCredentialId !== predecessor.credentialId) return false;
  if (successor.issuedAt.getTime() < predecessor.issuedAt.getTime()) return false;
  // A wallet that was ever marked compromised cannot establish a supersession (mirrors the issuing rule).
  if (successor.attestation.signerKey.compromisedAt !== null) return false;
  return checkSignedMaterial(successor, policy).every((o) => o.ok);
}

// ───────────────────────────── status change ─────────────────────────────

/** A valid ENDED StatusChangeAttestation (DOMAIN_MODEL §6.1 notes). */
export function checkStatusChange(
  att: AttestationEvidence,
  m: SignedMaterial,
  leafIndex: number,
  policy: VerificationPolicy,
): { ok: boolean; detail: string } {
  const key = att.signerKey;
  if (att.newStatus !== "ENDED" || att.statusSeq !== 2 || !att.effectiveAt) return { ok: false, detail: "Not an ENDED status change with the next sequence number." };
  if (att.organisationId !== m.organisationId || key.organisationId !== m.organisationId) return { ok: false, detail: "Signed for a different organisation." };
  if (!key.authorisationFinalized) return { ok: false, detail: "The signing wallet's authorisation is not finalised." };
  // Negative evidence is judged at the signed time: authorised then, and not already compromised then.
  if (!isKeyAuthorisedAt(key, att.issuedAt) || isKeyCompromisedAt(key, att.issuedAt)) return { ok: false, detail: "The signing wallet was not valid when it signed." };
  if (att.chainId !== Number(policy.domain.chainId) || att.verifyingContract !== policy.domain.verifyingContract) return { ok: false, detail: "Signed for a different chain or registry." };
  if (att.issuedAt.getTime() < m.issuedAt.getTime() || att.effectiveAt.getTime() < m.validFrom.getTime()) return { ok: false, detail: "Dated before the credential it ends." };
  const typed = attempt(() =>
    buildStatusChangeTypedData(farjiDomain(policy.domain), {
      credentialId: m.credentialId,
      orgId: m.orgId,
      leafIndex,
      newStatus: 1,
      effectiveAt: secs(att.effectiveAt!),
      statusSeq: att.statusSeq!,
      issuedAt: secs(att.issuedAt),
      nonce: att.nonce,
    }),
  );
  if (!typed || attempt(() => typedDataHash(typed)) !== att.typedDataHash) return { ok: false, detail: "The signed message does not match the recorded status change." };
  if (recoverSigner(typed, att.signature) !== key.walletAddress) return { ok: false, detail: "The signature does not recover to the recorded wallet." };
  return { ok: true, detail: "A valid status change signed by an authorised issuer wallet." };
}

// ───────────────────────────── anchors ─────────────────────────────

export const isFinalAnchor = (a: AnchorEvidence): boolean => a.transaction.status === "FINALIZED";

/** Organisation ownership, chain, and the purpose of the anchoring transaction. */
export function anchorCommonOutcomes(a: AnchorEvidence, organisationId: string, type: AttestationTypeName, policy: VerificationPolicy): CheckOutcome[] {
  const purpose = type === "COHORT" ? "ANCHOR_COHORT" : "ANCHOR_PROOF_PULSE";
  return [
    {
      id: "ANCHOR_ORGANISATION",
      ok: a.organisationId === organisationId && a.anchorerKeyOrganisationId === organisationId && a.attestationType === type,
      detail: "The anchor belongs to the issuing organisation's own chain of this type.",
      reason: "ANCHOR_ORGANISATION_MISMATCH",
    },
    {
      id: "ANCHOR_CHAIN",
      ok: a.transaction.chainId === Number(policy.domain.chainId) && a.transaction.purpose === purpose,
      detail: "The anchor was recorded on the configured chain by an anchoring transaction.",
      reason: "ANCHOR_CHAIN_MISMATCH",
    },
  ];
}

export type ChainVerdict = { status: "OK" | "GAP" | "BROKEN"; detail: string };

/**
 * Recomputes the organisation's attestation chain from epoch 1 to `upToEpoch` over FINALIZED anchors:
 * every `chainRoot` must equal the formula and link to its predecessor (zero hash at epoch 1).
 * A missing epoch means "not yet synchronised" (GAP, never proof of tampering); a wrong link is BROKEN.
 */
export function verifyChainPrefix(
  anchors: AnchorEvidence[],
  organisationId: string,
  orgId: string,
  type: AttestationTypeName,
  upToEpoch: number,
): ChainVerdict {
  const byEpoch = new Map<number, AnchorEvidence>();
  for (const a of anchors) {
    if (a.organisationId === organisationId && a.attestationType === type && isFinalAnchor(a)) byEpoch.set(a.epoch, a);
  }
  let previous = ZERO_HASH;
  for (let epoch = 1; epoch <= upToEpoch; epoch++) {
    const a = byEpoch.get(epoch);
    if (!a) return { status: "GAP", detail: `Epoch ${epoch} of the chain is not synchronised.` };
    const formula = attempt(() => chainRootOf(a.batchRoot, a.previousChainRoot, orgId, type, BigInt(epoch)));
    if (formula !== a.chainRoot) return { status: "BROKEN", detail: `Epoch ${epoch} does not match the chain-root formula.` };
    if (a.previousChainRoot !== previous) return { status: "BROKEN", detail: `Epoch ${epoch} does not link to its predecessor.` };
    previous = a.chainRoot;
  }
  return { status: "OK", detail: "The anchor chain is continuous from its first epoch." };
}

/** D7: `issuedAt <= anchoredAt <= issuedAt + maxAnchorDelay`. */
export function anchorWindow(issuedAt: Date, anchoredAt: Date, policy: VerificationPolicy): "OK" | "BEFORE" | "TOO_LATE" {
  if (anchoredAt.getTime() < issuedAt.getTime()) return "BEFORE";
  if (anchoredAt.getTime() > issuedAt.getTime() + policy.maxAnchorDelayMs) return "TOO_LATE";
  return "OK";
}

export function windowOutcome(issuedAt: Date, anchoredAt: Date, policy: VerificationPolicy): CheckOutcome {
  const w = anchorWindow(issuedAt, anchoredAt, policy);
  return {
    id: "ANCHOR_WINDOW",
    ok: w === "OK",
    detail: w === "OK" ? "The evidence was first anchored within the permitted window after signing." : w === "BEFORE" ? "The anchor predates the signature." : "The evidence was first anchored after the permitted window.",
    reason: w === "BEFORE" ? "ANCHOR_BEFORE_ISSUANCE" : "ANCHOR_TOO_LATE",
  };
}

// ───────────────────────────── path assessment ─────────────────────────────

/**
 * Outcome of checking a credential's Merkle + anchor evidence (cohort or ProofPulse):
 * - INVALID: a cryptographic or evidence check failed (the failures are in the collector);
 * - NONE: no qualifying FINALIZED anchor exists yet (PENDING), with the reason to show;
 * - OK: `first` is the first qualifying anchor; `latestActive` (ProofPulse) is the most recent finalized
 *   epoch whose root proves the leaf ACTIVE.
 */
export type PathAssessment =
  | { status: "INVALID" }
  | { status: "NONE"; reason: ReasonCode }
  | { status: "OK"; first: AnchorEvidence; latestActive: AnchorEvidence | null };

/** What a lifecycle module contributes to the final result (everything else comes from the precedence flow). */
export type LifecycleOutcome = {
  state: VerificationState;
  evidenceTimestamp?: Date | null;
  freshnessDeadline?: Date | null;
  expiry?: Date | null;
  endedAt?: Date | null;
};

/**
 * PENDING because no qualifying FINALIZED anchor exists yet. If the anchoring window has already run
 * out with no anchor at all, say so: the evidence can no longer qualify, but nothing has been proven
 * invalid either (D7), so the state stays PENDING.
 */
export function pendingOutcome(path: Extract<PathAssessment, { status: "NONE" }>, m: SignedMaterial, policy: VerificationPolicy, now: Date, c: Collector): LifecycleOutcome {
  if (path.reason === "AWAITING_ANCHOR" && now.getTime() > m.issuedAt.getTime() + policy.maxAnchorDelayMs) {
    c.check("ANCHOR_WINDOW", "PENDING", "No anchor exists and the permitted window has passed.");
    c.reason("ANCHOR_WINDOW_ELAPSED");
  }
  return { state: "PENDING" };
}
