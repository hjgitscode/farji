import { LIFECYCLE_CODE, SCHEMA_ID } from "@/lib/crypto/constants";
import { dateToUnixSeconds } from "@/lib/crypto/encoding";
import { EIP712_NAME, EIP712_VERSION } from "@/lib/crypto/constants";
import { cohortLeafHash } from "@/lib/merkle/cohort";
import { pulseSnapshots } from "./continuing";
import type { AnchorEvidence, CredentialEvidence, VerificationResult } from "./types";

// Public proof bundle (ROADMAP Phase 13). A JSON document with enough PUBLIC evidence to understand and re-check a
// FARJI verification with the same helpers FARJI itself uses (`verifyCohortProof`, `verifyPulseProof`, `chainRootOf`,
// ecrecover over `typedDataHash`): it is the Phase 10 evidence, serialised, not a second format.
//
// What is deliberately NOT in it, and why:
//   - credentialSalt, contentSalt, subjectSalt: private (only credentialSalt can ever become public, and only through an
//     on-chain revocation event, which the chain already shows);
//   - the claim content, the candidate id, reviewer notes, source references, audit data: private;
//   - the signing nonce: part of the signed message, which cannot be rebuilt without the private content salt.
// Consequence: a third party can check the signer, the inclusion proof, the anchor chain and the timestamps; re-deriving the
// full signed message needs the holder to disclose the content and salt. That is a property of the privacy design.

export const PROOF_BUNDLE_FORMAT = "farji.proof-bundle";
export const PROOF_BUNDLE_VERSION = 1;

export type AnchorTxInfo = { transactionHash: string; blockNumber: string };

export type BundleInput = {
  evidence: CredentialEvidence;
  result: VerificationResult;
  domain: { chainId: bigint; verifyingContract: string };
  now: Date;
  /** Transaction hash and block per Anchor id (read by the server; FINALIZED anchors only matter). */
  anchorTx: Record<string, AnchorTxInfo>;
  revocationTx?: AnchorTxInfo | null;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function anchorJson(a: AnchorEvidence, tx: AnchorTxInfo | undefined) {
  return {
    attestationType: a.attestationType,
    epoch: a.epoch,
    batchRoot: a.batchRoot,
    previousChainRoot: a.previousChainRoot,
    chainRoot: a.chainRoot,
    leafCount: a.leafCount,
    ...(a.rootSeq !== null ? { rootSeq: a.rootSeq } : {}),
    anchoredAt: iso(a.blockTimestamp),
    transactionStatus: a.transaction.status,
    transactionHash: tx?.transactionHash ?? null,
    blockNumber: tx?.blockNumber ?? null,
  };
}

/** Builds the bundle, or null when the credential has no signed material (nothing public to export). */
export function buildProofBundle(input: BundleInput) {
  const { evidence: ev, result, domain, now } = input;
  const m = ev.signed;
  if (!m) return null;
  const att = m.attestation;
  const key = att.signerKey;
  const sum = result.evidenceSummary;

  // Merkle evidence: only when the engine found the credential anchored (OK path), and exactly what it verified.
  let merkleEvidence: Record<string, unknown> | null = null;
  let anchorEvidence: Record<string, unknown> | null = null;
  let latestAnchorEvidence: Record<string, unknown> | null = null;
  if (sum.anchored && sum.attestationType === "COHORT" && ev.cohort) {
    const leaf = {
      orgId: m.orgId,
      credentialId: m.credentialId,
      subjectCommitment: m.subjectCommitment,
      contentDigest: m.contentDigest,
      lifecycleType: LIFECYCLE_CODE[m.lifecycleType],
      validFrom: dateToUnixSeconds(m.validFrom).toString(),
      validUntil: m.validUntil ? dateToUnixSeconds(m.validUntil).toString() : "0",
      issuedAt: dateToUnixSeconds(m.issuedAt).toString(),
      schemaId: SCHEMA_ID,
    };
    merkleEvidence = {
      type: "COHORT",
      leaf,
      leafHash: cohortLeafHash({ ...leaf, validFrom: BigInt(leaf.validFrom), validUntil: BigInt(leaf.validUntil), issuedAt: BigInt(leaf.issuedAt) }),
      siblings: ev.cohort.proof?.siblings ?? [],
      batchRoot: ev.cohort.batch.batchRoot,
      leafCount: ev.cohort.batch.leafCount,
    };
    const anchor = ev.anchors.find((a) => a.id === ev.cohort!.batch.anchorId);
    anchorEvidence = anchor ? anchorJson(anchor, input.anchorTx[anchor.id]) : null;
  } else if (sum.anchored && sum.attestationType === "PROOF_PULSE" && ev.pulse) {
    const finals = ev.anchors.filter((a) => a.attestationType === "PROOF_PULSE" && a.rootSeq !== null && a.transaction.status === "FINALIZED").sort((a, b) => a.epoch - b.epoch);
    const first = finals.find((a) => a.epoch === sum.anchorEpoch);
    const latest = finals.find((a) => a.epoch === sum.latestPulseEpoch);
    const wanted = [first, latest].filter((a): a is AnchorEvidence => !!a);
    try {
      const snaps = pulseSnapshots(ev.pulse.depth, ev.pulse.log, ev.pulse.leaf.leafIndex, wanted.map((a) => a.rootSeq!));
      const proofFor = (a: AnchorEvidence) => {
        const s = snaps.get(a.rootSeq!);
        return s ? { epoch: a.epoch, rootSeq: a.rootSeq, root: s.root, leafHash: s.leafHash, siblings: s.siblings } : null;
      };
      merkleEvidence = {
        type: "PROOF_PULSE",
        depth: ev.pulse.depth,
        leafIndex: ev.pulse.leaf.leafIndex,
        scope: ev.pulse.leaf.scope,
        firstEpochProof: first ? proofFor(first) : null,
        latestActiveEpochProof: latest ? proofFor(latest) : null,
      };
    } catch {
      merkleEvidence = null; // an inconsistent log has no exportable proof (the engine would not have called it anchored)
    }
    anchorEvidence = first ? anchorJson(first, input.anchorTx[first.id]) : null;
    latestAnchorEvidence = latest && latest !== first ? anchorJson(latest, input.anchorTx[latest.id]) : null;
  }

  return {
    format: PROOF_BUNDLE_FORMAT,
    version: PROOF_BUNDLE_VERSION,
    generatedAt: now.toISOString(),
    network: { chainId: domain.chainId.toString(), registryContract: domain.verifyingContract },
    credential: {
      credentialId: m.credentialId,
      category: m.category,
      lifecycleType: m.lifecycleType,
      issuedAt: iso(m.issuedAt),
      validFrom: iso(m.validFrom),
      validUntil: iso(m.validUntil),
      schemaId: SCHEMA_ID,
      subjectCommitment: m.subjectCommitment,
      contentDigest: m.contentDigest,
    },
    organisation: { name: ev.organisation.displayName, orgId: m.orgId },
    lifecycle: m.lifecycleType,
    derivedState: {
      state: result.state,
      evaluatedAt: now.toISOString(),
      evidenceTimestamp: iso(result.evidenceTimestamp),
      freshnessDeadline: iso(result.freshnessDeadline),
      expiry: iso(result.expiry),
      endedAt: iso(result.endedAt),
      revokedAt: iso(result.revokedAt),
      reasons: result.reasons.map((r) => ({ code: r.code, message: r.message })),
      checks: result.checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail })),
    },
    safeAttestationEvidence: {
      signerWallet: key.walletAddress,
      typedDataHash: att.typedDataHash,
      signature: att.signature,
      issuedAt: iso(att.issuedAt),
      signerKey: { authorisedFrom: iso(key.validFrom), retiredAt: iso(key.validUntil), compromisedAt: iso(key.compromisedAt) },
      domain: { name: EIP712_NAME, version: EIP712_VERSION, chainId: domain.chainId.toString(), verifyingContract: domain.verifyingContract },
    },
    merkleEvidence,
    anchorEvidence,
    latestAnchorEvidence,
    revocation: result.revokedAt ? { revokedAt: iso(result.revokedAt), transactionHash: input.revocationTx?.transactionHash ?? null, blockNumber: input.revocationTx?.blockNumber ?? null } : null,
    verificationSummary: { state: result.state, headline: result.reasons[0]?.message ?? null },
  };
}

export type ProofBundle = NonNullable<ReturnType<typeof buildProofBundle>>;
