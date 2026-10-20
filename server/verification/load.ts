import { ZERO_HASH } from "@/lib/crypto/constants";
import type { CategoryName, LifecycleName } from "@/lib/crypto/constants";
import type { Prisma, PrismaClient } from "@/lib/database/generated/client";
import type {
  AnchorEvidence,
  AttestationEvidence,
  CredentialEvidence,
  KeyEvidence,
  PulseEvidence,
  SignedMaterial,
} from "@/lib/verification/types";

// Evidence loaders (ROADMAP Phase 10): assemble the RAW evidence bundle the pure engine derives from.
//
// This module only READS and maps rows to the engine's input model. It performs no verification and writes
// nothing; it never reads `pipelineStatus` as proof (only to notice a "signed" credential with no attestation),
// and it never passes reviewer notes, source-of-truth references or audit data to the engine. Salts and claim
// content ARE read (the engine must recompute digests) but live only in the input bundle, never in a result.

export type VerificationDb = Pick<
  PrismaClient,
  "credential" | "anchor" | "proofPulseUpdate" | "claim" | "verificationRequest" | "organisation"
>;

const KEY_SELECT = {
  id: true,
  organisationId: true,
  walletAddress: true,
  validFrom: true,
  validUntil: true,
  compromisedAt: true,
  authoriseTransaction: { select: { status: true } },
} as const;

const ATTESTATION_SELECT = {
  id: true,
  kind: true,
  organisationId: true,
  signature: true,
  typedDataHash: true,
  nonce: true,
  issuedAt: true,
  chainId: true,
  verifyingContract: true,
  statusSeq: true,
  newStatus: true,
  effectiveAt: true,
  signerKey: { select: KEY_SELECT },
} as const;

const MATERIAL_SELECT = {
  id: true,
  organisationId: true,
  lifecycleType: true,
  pipelineStatus: true,
  credentialId: true,
  credentialSalt: true,
  contentSalt: true,
  subjectSalt: true,
  subjectCommitment: true,
  contentDigest: true,
  validFrom: true,
  validUntil: true,
  issuedAt: true,
  organisation: { select: { id: true, orgId: true, displayName: true, pulseFreshnessDays: true } },
  claimVersion: { select: { content: true, claim: { select: { category: true, candidateId: true } } } },
  supersedes: { select: { credentialId: true } },
  attestations: { where: { kind: "CREDENTIAL" as const }, select: ATTESTATION_SELECT },
} as const;

const EVIDENCE_SELECT = {
  ...MATERIAL_SELECT,
  attestations: { select: ATTESTATION_SELECT },
  supersededBy: { select: MATERIAL_SELECT },
  cohortLeaf: {
    select: { leafHash: true, proof: true, batch: { select: { status: true, batchRoot: true, leafCount: true, anchorId: true } } },
  },
  proofPulseLeaf: { select: { leafIndex: true, scope: true, treeId: true, tree: { select: { depth: true } } } },
  revocation: {
    select: {
      organisationId: true,
      revokedAt: true,
      revokerKey: { select: { organisationId: true } },
      transaction: { select: { status: true, purpose: true, chainId: true } },
    },
  },
} as const;

type MaterialRow = Prisma.CredentialGetPayload<{ select: typeof MATERIAL_SELECT }>;
type EvidenceRow = Prisma.CredentialGetPayload<{ select: typeof EVIDENCE_SELECT }>;
type AttestationRow = Prisma.AttestationGetPayload<{ select: typeof ATTESTATION_SELECT }>;

const ANCHOR_SELECT = {
  id: true,
  organisationId: true,
  attestationType: true,
  epoch: true,
  batchRoot: true,
  previousChainRoot: true,
  chainRoot: true,
  rootSeq: true,
  leafCount: true,
  blockTimestamp: true,
  anchorerKey: { select: { organisationId: true } },
  transaction: { select: { status: true, purpose: true, chainId: true } },
} as const;

// ───────────────────────────── row -> engine input ─────────────────────────────

const toKey = (k: AttestationRow["signerKey"]): KeyEvidence => ({
  id: k.id,
  organisationId: k.organisationId,
  walletAddress: k.walletAddress.toLowerCase(),
  validFrom: k.validFrom,
  validUntil: k.validUntil,
  compromisedAt: k.compromisedAt,
  authorisationFinalized: k.authoriseTransaction?.status === "FINALIZED",
});

const toAttestation = (a: AttestationRow): AttestationEvidence => ({
  id: a.id,
  organisationId: a.organisationId,
  signature: a.signature,
  typedDataHash: a.typedDataHash,
  nonce: a.nonce,
  issuedAt: a.issuedAt,
  chainId: a.chainId,
  verifyingContract: a.verifyingContract,
  signerKey: toKey(a.signerKey),
  statusSeq: a.statusSeq,
  newStatus: a.newStatus,
  effectiveAt: a.effectiveAt,
});

/** The signed material of a credential, or null when it has no CREDENTIAL attestation / incomplete columns. */
export function toSignedMaterial(row: MaterialRow): SignedMaterial | null {
  const att = row.attestations.find((a) => a.kind === "CREDENTIAL");
  const { credentialId, credentialSalt, contentSalt, subjectSalt, subjectCommitment, contentDigest, validFrom, issuedAt } = row;
  if (!att || !credentialId || !credentialSalt || !contentSalt || !subjectSalt || !subjectCommitment || !contentDigest || !validFrom || !issuedAt) return null;
  return {
    organisationId: row.organisationId,
    orgId: row.organisation.orgId,
    lifecycleType: row.lifecycleType as LifecycleName,
    category: row.claimVersion.claim.category as CategoryName,
    claimContent: row.claimVersion.content,
    candidateId: row.claimVersion.claim.candidateId,
    credentialSalt,
    contentSalt,
    subjectSalt,
    credentialId,
    subjectCommitment,
    contentDigest,
    validFrom,
    validUntil: row.validUntil,
    issuedAt,
    // The predecessor's id as it was in the signed message; the engine proves it by recomputing the hash.
    supersedesCredentialId: row.supersedes?.credentialId ?? ZERO_HASH,
    attestation: toAttestation(att),
  };
}

function toAnchor(a: Prisma.AnchorGetPayload<{ select: typeof ANCHOR_SELECT }>): AnchorEvidence {
  return {
    id: a.id,
    organisationId: a.organisationId,
    attestationType: a.attestationType,
    epoch: a.epoch,
    batchRoot: a.batchRoot,
    previousChainRoot: a.previousChainRoot,
    chainRoot: a.chainRoot,
    rootSeq: a.rootSeq,
    leafCount: a.leafCount,
    anchorerKeyOrganisationId: a.anchorerKey.organisationId,
    blockTimestamp: a.blockTimestamp,
    transaction: { status: a.transaction.status, purpose: a.transaction.purpose, chainId: a.transaction.chainId },
  };
}

// ───────────────────────────── loading ─────────────────────────────

/** Per-call cache so a page of claims reads each organisation's anchors and each tree's log once. */
export type LoadCache = {
  anchors: Map<string, Promise<AnchorEvidence[]>>;
  logs: Map<string, Promise<PulseEvidence["log"]>>;
};
export const newLoadCache = (): LoadCache => ({ anchors: new Map(), logs: new Map() });

function organisationAnchors(db: VerificationDb, cache: LoadCache, organisationId: string, type: "COHORT" | "PROOF_PULSE"): Promise<AnchorEvidence[]> {
  const key = `${organisationId}:${type}`;
  let p = cache.anchors.get(key);
  if (!p) {
    p = db.anchor
      .findMany({ where: { organisationId, attestationType: type }, orderBy: { epoch: "asc" }, select: ANCHOR_SELECT })
      .then((rows) => rows.map(toAnchor));
    cache.anchors.set(key, p);
  }
  return p;
}

function pulseLog(db: VerificationDb, cache: LoadCache, treeId: string): Promise<PulseEvidence["log"]> {
  let p = cache.logs.get(treeId);
  if (!p) {
    p = db.proofPulseUpdate
      .findMany({
        where: { treeId },
        orderBy: { rootSeq: "asc" },
        select: { rootSeq: true, kind: true, leafIndex: true, newLeafHash: true, previousRoot: true, newRoot: true, causedByAttestationId: true },
      })
      .then((rows) => rows);
    cache.logs.set(treeId, p);
  }
  return p;
}

/** The raw evidence bundle of one credential, or null if it does not exist. */
export async function loadCredentialEvidence(db: VerificationDb, credentialRowId: string, cache: LoadCache = newLoadCache()): Promise<{ evidence: CredentialEvidence; pulseFreshnessDays: number } | null> {
  const row: EvidenceRow | null = await db.credential.findUnique({ where: { id: credentialRowId }, select: EVIDENCE_SELECT });
  if (!row) return null;

  const lifecycleType = row.lifecycleType as LifecycleName;
  const material = toSignedMaterial({ ...row, attestations: row.attestations.filter((a) => a.kind === "CREDENTIAL") });
  const type = lifecycleType === "CONTINUING" ? "PROOF_PULSE" : "COHORT";
  const anchors = material ? await organisationAnchors(db, cache, row.organisationId, type) : [];

  let pulse: PulseEvidence | null = null;
  if (material && row.proofPulseLeaf && lifecycleType === "CONTINUING") {
    pulse = {
      depth: row.proofPulseLeaf.tree.depth,
      leaf: { leafIndex: row.proofPulseLeaf.leafIndex, scope: row.proofPulseLeaf.scope },
      log: await pulseLog(db, cache, row.proofPulseLeaf.treeId),
    };
  }

  const successorRow = row.supersededBy;
  const evidence: CredentialEvidence = {
    rowId: row.id,
    organisation: { id: row.organisation.id, displayName: row.organisation.displayName },
    lifecycleType,
    // Workflow status is used ONLY to notice missing evidence; it is never proof of anything.
    workflowSigned: row.pipelineStatus !== "AWAITING_SIGNATURE",
    signed: material,
    cohort:
      material && row.cohortLeaf && lifecycleType !== "CONTINUING"
        ? {
            leafHash: row.cohortLeaf.leafHash,
            proof: parseProof(row.cohortLeaf.proof),
            batch: row.cohortLeaf.batch,
          }
        : null,
    pulse,
    anchors,
    statusChanges: row.attestations.filter((a) => a.kind === "STATUS_CHANGE").map(toAttestation),
    revocation: row.revocation
      ? {
          organisationId: row.revocation.organisationId,
          revokerKeyOrganisationId: row.revocation.revokerKey.organisationId,
          revokedAt: row.revocation.revokedAt,
          transaction: { status: row.revocation.transaction.status, purpose: row.revocation.transaction.purpose, chainId: row.revocation.transaction.chainId },
        }
      : null,
    successor: successorRow ? toSignedMaterial(successorRow) : null,
  };
  return { evidence, pulseFreshnessDays: row.organisation.pulseFreshnessDays };
}

function parseProof(value: unknown): { siblings: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const siblings = (value as { siblings?: unknown }).siblings;
  return Array.isArray(siblings) && siblings.every((s) => typeof s === "string") ? { siblings } : null;
}
