import type { Actor } from "@/lib/auth/authorize";
import { PULSE_STATUS_CODE } from "@/lib/crypto/constants";
import { nowSeconds, unixSecondsToDate } from "@/lib/crypto/encoding";
import {
  buildStatusChangeTypedData,
  farjiDomain,
  normaliseSignature,
  recoverSigner,
  toWalletTypedData,
  typedDataHash,
  type StatusChangeMessage,
  type TypedData,
} from "@/lib/crypto/eip712";
import { DomainError } from "@/server/candidate/errors";
import { assertIssuer, assertStillActiveMember } from "@/server/issuer/review";
import { loadIssuedCredential } from "@/server/merkle/material";
import { applyPulseStatusChange } from "@/server/merkle/pulse";
import {
  assertIssuedAtWindow,
  audit,
  inTransaction,
  isUniqueViolation,
  isUuid,
  parseIssuedAt,
  parseNonce,
  parseUnixSeconds,
  requireSigningKey,
  type IssuanceDb,
  type SignatureInput,
  type Tx,
} from "./common";
import { getEip712Config } from "./config";
import { randomBytes32 } from "./random";
import type { SigningOptions } from "./signing";

// Ending a CONTINUING relationship (ROADMAP Phase 6/7; ARCHITECTURE §6.4).
//
// The issuer signs a StatusChangeAttestation (ENDED, next statusSeq); the server verifies it,
// stores it, and updates exactly one ProofPulse leaf and its path. ENDED is NOT revocation:
// no Revocation row, no new Credential and no deletion happens here. The attestation's
// `statusSeq` (unique per credential in the database) is what stops an old attestation from
// being replayed or an ENDED leaf from being rolled back.

export type PreparedStatusChange = {
  credentialRowId: string;
  leafIndex: number;
  statusSeq: number;
  effectiveAt: string;
  issuedAt: string;
  nonce: string;
  typedDataHash: string;
  typedData: TypedData<StatusChangeMessage>;
  walletTypedData: ReturnType<typeof toWalletTypedData>;
};

async function loadLeaf(tx: Tx, organisationId: string, credentialRowId: string) {
  const leaf = await tx.proofPulseLeaf.findFirst({
    where: { credentialRowId, organisationId },
    select: { id: true, leafIndex: true, status: true, statusSeq: true, statusEffectiveAt: true },
  });
  if (!leaf) throw new DomainError("CONFLICT", "This credential has no ProofPulse leaf.");
  return leaf;
}

function assertEffectiveAt(effectiveAt: bigint, validFrom: bigint, nowSec: bigint): void {
  // The relationship cannot end before it began, and an end cannot be dated in the future.
  if (effectiveAt < validFrom || effectiveAt > nowSec) {
    throw new DomainError("VALIDATION", "The end date must be between the start of the record and now.", {
      effectiveAt: "Must be between the start of the record and now.",
    });
  }
}

export async function prepareEndRelationship(
  db: IssuanceDb,
  actor: Actor,
  credentialRowId: string,
  input: { effectiveAt: Date },
  opts: SigningOptions = {},
): Promise<PreparedStatusChange> {
  const scope = assertIssuer(actor);
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  const domain = farjiDomain(opts.config ?? getEip712Config());
  const now = opts.now ?? new Date();
  const random = opts.random ?? randomBytes32;
  const nowSec = nowSeconds(now);
  const effectiveMs = input?.effectiveAt instanceof Date ? input.effectiveAt.getTime() : NaN;
  if (!Number.isFinite(effectiveMs) || effectiveMs % 1000 !== 0) {
    throw new DomainError("VALIDATION", "Invalid end date.", { effectiveAt: "Invalid end date." });
  }
  const effectiveAt = BigInt(effectiveMs / 1000);

  return inTransaction(db, async (tx) => {
    await assertStillActiveMember(tx, scope);
    const credential = await loadIssuedCredential(tx, scope, credentialRowId);
    if (credential.lifecycleType !== "CONTINUING") throw new DomainError("CONFLICT", "Only a CONTINUING relationship can end.");
    const leaf = await loadLeaf(tx, scope.organisationId, credential.id);
    if (leaf.status !== "ACTIVE") throw new DomainError("CONFLICT", "This relationship has already ended.");
    assertEffectiveAt(effectiveAt, credential.validFrom, nowSec);

    const statusSeq = leaf.statusSeq + 1;
    const nonce = random();
    const typedData = buildStatusChangeTypedData(domain, {
      credentialId: credential.credentialId,
      orgId: credential.orgId,
      leafIndex: leaf.leafIndex,
      newStatus: PULSE_STATUS_CODE.ENDED,
      effectiveAt,
      statusSeq,
      issuedAt: nowSec,
      nonce,
    });
    await audit(tx, scope, "STATUS_CHANGE_PREPARED", "Credential", credential.id, { leafIndex: leaf.leafIndex, statusSeq });
    return {
      credentialRowId: credential.id,
      leafIndex: leaf.leafIndex,
      statusSeq,
      effectiveAt: effectiveAt.toString(),
      issuedAt: nowSec.toString(),
      nonce,
      typedDataHash: typedDataHash(typedData),
      typedData,
      walletTypedData: toWalletTypedData(typedData),
    };
  });
}

export type AcceptedStatusChange = {
  credentialRowId: string;
  attestationId: string;
  typedDataHash: string;
  statusSeq: number;
  leafIndex: number;
  idempotent: boolean;
  rootSeq?: number;
};

export async function acceptStatusChange(
  db: IssuanceDb,
  actor: Actor,
  credentialRowId: string,
  rawInput: SignatureInput & { effectiveAt: unknown },
  opts: SigningOptions = {},
): Promise<AcceptedStatusChange> {
  const scope = assertIssuer(actor);
  if (!isUuid(credentialRowId)) throw new DomainError("NOT_FOUND", "Credential not found.");
  const issuedAt = parseIssuedAt(rawInput?.issuedAt);
  const effectiveAt = parseUnixSeconds(rawInput?.effectiveAt, "effectiveAt");
  const nonce = parseNonce(rawInput?.nonce);
  const signature = normaliseSignature(rawInput?.signature);
  if (!signature) throw new DomainError("VALIDATION", "Invalid signature.", { signature: "Invalid signature." });
  const domain = farjiDomain(opts.config ?? getEip712Config());
  const now = opts.now ?? new Date();
  const nowSec = nowSeconds(now);

  return inTransaction(db, async (tx) => {
    await assertStillActiveMember(tx, scope);
    const credential = await loadIssuedCredential(tx, scope, credentialRowId);
    if (credential.lifecycleType !== "CONTINUING") throw new DomainError("CONFLICT", "Only a CONTINUING relationship can end.");
    const leaf = await loadLeaf(tx, scope.organisationId, credential.id);

    const build = (statusSeq: number) =>
      buildStatusChangeTypedData(domain, {
        credentialId: credential.credentialId,
        orgId: credential.orgId,
        leafIndex: leaf.leafIndex,
        newStatus: PULSE_STATUS_CODE.ENDED,
        effectiveAt,
        statusSeq,
        issuedAt,
        nonce,
      });

    if (leaf.status !== "ACTIVE") {
      // Retry of an already applied change: success only for the very same signed message.
      const typedData = build(leaf.statusSeq);
      const hash = typedDataHash(typedData);
      const existing = await tx.attestation.findFirst({
        where: { credentialRowId: credential.id, kind: "STATUS_CHANGE", statusSeq: leaf.statusSeq },
        select: { id: true, typedDataHash: true },
      });
      if (existing && existing.typedDataHash === hash) {
        return { credentialRowId: credential.id, attestationId: existing.id, typedDataHash: hash, statusSeq: leaf.statusSeq, leafIndex: leaf.leafIndex, idempotent: true };
      }
      throw new DomainError("CONFLICT", "This relationship has already ended.");
    }

    // The message is rebuilt from the database: the next statusSeq is NEVER taken from the client.
    const statusSeq = leaf.statusSeq + 1;
    const typedData = build(statusSeq);
    const hash = typedDataHash(typedData);
    assertIssuedAtWindow(issuedAt, nowSec);
    assertEffectiveAt(effectiveAt, credential.validFrom, nowSec);

    const signer = recoverSigner(typedData, signature);
    if (!signer) throw new DomainError("VALIDATION", "Invalid signature.", { signature: "Invalid signature." });
    const signerKeyId = await requireSigningKey(tx, credential.organisationId, signer, unixSecondsToDate(issuedAt), now, scope.memberId);

    const chainId = Number(domain.chainId);
    if (!Number.isSafeInteger(chainId) || chainId > 2147483647) throw new DomainError("CONFLICT", "Unsupported chain id.");
    let attestationId: string;
    try {
      const attestation = await tx.attestation.create({
        data: {
          kind: "STATUS_CHANGE",
          credentialRowId: credential.id,
          organisationId: credential.organisationId,
          signerKeyId,
          typedDataHash: hash,
          signature,
          nonce,
          issuedAt: unixSecondsToDate(issuedAt),
          chainId,
          verifyingContract: domain.verifyingContract,
          statusSeq,
          newStatus: "ENDED",
          effectiveAt: unixSecondsToDate(effectiveAt),
        },
        select: { id: true },
      });
      attestationId = attestation.id;
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError("CONFLICT", "This status change has already been recorded.");
      throw e;
    }

    const applied = await applyPulseStatusChange(tx, scope, credential.id, { attestationId, effectiveAt, statusSeq }, now);
    await audit(tx, scope, "STATUS_CHANGE_ACCEPTED", "Credential", credential.id, { attestationId, statusSeq, leafIndex: leaf.leafIndex, rootSeq: applied.rootSeq });
    return { credentialRowId: credential.id, attestationId, typedDataHash: hash, statusSeq, leafIndex: leaf.leafIndex, idempotent: false, rootSeq: applied.rootSeq };
  });
}
