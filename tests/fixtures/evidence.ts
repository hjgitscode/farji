import { randomBytes, randomUUID } from "node:crypto";
import { canonicalCredentialContent } from "@/lib/crypto/canonical";
import { chainRootOf } from "@/lib/crypto/chain-root";
import { contentDigestOf, credentialIdOf, subjectCommitmentOf } from "@/lib/crypto/commitments";
import { LIFECYCLE_CODE, PULSE_STATUS_CODE, SCHEMA_ID, SCOPE_CODE, ZERO_HASH, type AttestationTypeName, type LifecycleName } from "@/lib/crypto/constants";
import { buildCredentialTypedData, buildStatusChangeTypedData, farjiDomain, typedDataHash } from "@/lib/crypto/eip712";
import { dateToUnixSeconds, isoDateToUnixSeconds, uuidToBytes16 } from "@/lib/crypto/encoding";
import { buildCohortTree, cohortLeafHash, type CohortLeafInput } from "@/lib/merkle/cohort";
import { emptyPulseRoot, pulseLeafHash, SparsePulseTree } from "@/lib/merkle/pulse";
import type {
  AnchorEvidence,
  AttestationEvidence,
  CredentialEvidence,
  KeyEvidence,
  PulseEvidence,
  SignedMaterial,
  TxEvidence,
  VerificationPolicy,
} from "@/lib/verification/types";
import { freshWallet, TEST_CONFIG, type TestWallet } from "./test-wallets";

// TEST-ONLY builder of REAL, fully signed and Merkle-anchored evidence bundles for the pure engine's tests.
// It lives in tests/fixtures because it signs with a test wallet (the only place private keys may exist).
// Every hash, signature and Merkle fold is produced by the production helpers; tests then break ONE thing.

const DAY = 86_400_000;
export const POLICY: VerificationPolicy = { maxAnchorDelayMs: 30 * DAY, pulseFreshnessDays: 45, domain: TEST_CONFIG };
export const ISSUED_AT = new Date("2026-03-01T10:00:00Z");
export const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);
export const days = (n: number) => n * DAY;

const b32 = () => "0x" + randomBytes(32).toString("hex");
const FINAL: TxEvidence["status"] = "FINALIZED";
export const tx = (purpose: string, status: TxEvidence["status"] = FINAL): TxEvidence => ({ status, purpose, chainId: Number(TEST_CONFIG.chainId) });

export type Org = { id: string; orgId: string; displayName: string };
export const mkOrg = (): Org => ({ id: randomUUID(), orgId: b32(), displayName: "Acme Ltd" });

export function mkKey(org: Org, wallet: TestWallet, over: Partial<KeyEvidence> = {}): KeyEvidence {
  return {
    id: randomUUID(),
    organisationId: org.id,
    walletAddress: wallet.address.toLowerCase(),
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: null,
    compromisedAt: null,
    authorisationFinalized: true,
    ...over,
  };
}

const CONTENT: Record<LifecycleName, Record<string, string>> = {
  PERMANENT: { title: "Software Engineer", organisationName: "Acme Ltd", startDate: "2022-01-10", endDate: "2024-03-31" },
  CONTINUING: { title: "Software Engineer", organisationName: "Acme Ltd", startDate: "2022-01-10" },
  EXPIRING: { title: "Licensed Engineer", organisationName: "Acme Ltd", startDate: "2022-01-10", expiryDate: "2027-03-31" },
};
const CATEGORY = { PERMANENT: "EXPERIENCE", CONTINUING: "EXPERIENCE", EXPIRING: "CERTIFICATION" } as const;

export type SignOptions = {
  org: Org;
  wallet: TestWallet;
  key?: KeyEvidence;
  lifecycle: LifecycleName;
  candidateId?: string;
  issuedAt?: Date;
  supersedesCredentialId?: string;
};

/** A credential signed by `wallet` under the test domain. */
export async function signMaterial(o: SignOptions): Promise<SignedMaterial> {
  const lifecycle = o.lifecycle;
  const category = CATEGORY[lifecycle];
  const claimContent = CONTENT[lifecycle];
  const candidateId = o.candidateId ?? randomUUID();
  const issuedAt = o.issuedAt ?? ISSUED_AT;
  const [credentialSalt, contentSalt, subjectSalt] = [b32(), b32(), b32()];
  const canonical = canonicalCredentialContent(category, lifecycle, claimContent);
  if (!canonical.ok) throw new Error("fixture content is invalid");

  const credentialId = credentialIdOf(o.org.orgId, credentialSalt);
  const subjectCommitment = subjectCommitmentOf(uuidToBytes16(candidateId), subjectSalt);
  const contentDigest = contentDigestOf(canonical.value, contentSalt);
  const validFrom = new Date(Number(isoDateToUnixSeconds(canonical.value.startDate)) * 1000);
  const validUntil = lifecycle === "EXPIRING" ? new Date(Number(isoDateToUnixSeconds(canonical.value.expiryDate)) * 1000) : null;
  const supersedesCredentialId = o.supersedesCredentialId ?? ZERO_HASH;
  const nonce = b32();
  const typed = buildCredentialTypedData(farjiDomain(TEST_CONFIG), {
    credentialId,
    orgId: o.org.orgId,
    subjectCommitment,
    content: canonical.value,
    contentSalt,
    lifecycleType: LIFECYCLE_CODE[lifecycle],
    validFrom: dateToUnixSeconds(validFrom),
    validUntil: validUntil ? dateToUnixSeconds(validUntil) : 0n,
    supersedesCredentialId,
    issuedAt: dateToUnixSeconds(issuedAt),
    nonce,
  });
  const signature = (await o.wallet.signTypedData(typed.domain, typed.types, typed.message)).toLowerCase();
  const key = o.key ?? mkKey(o.org, o.wallet);
  const attestation: AttestationEvidence = {
    id: randomUUID(),
    organisationId: o.org.id,
    signature,
    typedDataHash: typedDataHash(typed),
    nonce,
    issuedAt,
    chainId: Number(TEST_CONFIG.chainId),
    verifyingContract: TEST_CONFIG.verifyingContract,
    signerKey: key,
    statusSeq: null,
    newStatus: null,
    effectiveAt: null,
  };
  return {
    organisationId: o.org.id,
    orgId: o.org.orgId,
    lifecycleType: lifecycle,
    category,
    claimContent,
    candidateId,
    credentialSalt,
    contentSalt,
    subjectSalt,
    credentialId,
    subjectCommitment,
    contentDigest,
    validFrom,
    validUntil,
    issuedAt,
    supersedesCredentialId,
    attestation,
  };
}

export function mkAnchor(o: {
  org: Org;
  type: AttestationTypeName;
  epoch: number;
  batchRoot: string;
  previousChainRoot: string;
  at: Date;
  rootSeq?: number | null;
  leafCount?: number;
  status?: TxEvidence["status"];
}): AnchorEvidence {
  return {
    id: randomUUID(),
    organisationId: o.org.id,
    attestationType: o.type,
    epoch: o.epoch,
    batchRoot: o.batchRoot,
    previousChainRoot: o.previousChainRoot,
    chainRoot: chainRootOf(o.batchRoot, o.previousChainRoot, o.org.orgId, o.type, BigInt(o.epoch)),
    rootSeq: o.type === "PROOF_PULSE" ? (o.rootSeq ?? 1) : null,
    leafCount: o.leafCount ?? 1,
    anchorerKeyOrganisationId: o.org.id,
    blockTimestamp: o.at,
    transaction: tx(o.type === "COHORT" ? "ANCHOR_COHORT" : "ANCHOR_PROOF_PULSE", o.status),
  };
}

/** Epochs 1..n-1 of a chain with arbitrary roots, so the anchor at epoch n has a valid history. */
function priorChain(org: Org, type: AttestationTypeName, upTo: number, at: Date): AnchorEvidence[] {
  const out: AnchorEvidence[] = [];
  let previous = ZERO_HASH;
  for (let epoch = 1; epoch < upTo; epoch++) {
    const a = mkAnchor({ org, type, epoch, batchRoot: b32(), previousChainRoot: previous, at, rootSeq: epoch === 1 ? 1 : undefined });
    out.push(a);
    previous = a.chainRoot;
  }
  return out;
}

export type Built = {
  org: Org;
  wallet: TestWallet;
  material: SignedMaterial;
  ev: CredentialEvidence;
  policy: VerificationPolicy;
};

const baseEvidence = (org: Org, material: SignedMaterial): CredentialEvidence => ({
  rowId: randomUUID(),
  organisation: { id: org.id, displayName: org.displayName },
  lifecycleType: material.lifecycleType,
  workflowSigned: true,
  signed: material,
  cohort: null,
  pulse: null,
  anchors: [],
  statusChanges: [],
  revocation: null,
  successor: null,
});

export type CohortOptions = {
  lifecycle?: "PERMANENT" | "EXPIRING";
  issuedAt?: Date;
  /** When the batch root is anchored (a FINALIZED anchor); null = never anchored. */
  anchoredAt?: Date | null;
  anchorStatus?: TxEvidence["status"];
  /** Other credentials in the same batch (so the proof has real siblings). */
  fillers?: number;
  /** Position of the anchor in the COHORT chain (earlier epochs are generated). */
  epoch?: number;
  wallet?: TestWallet;
  keyOver?: Partial<KeyEvidence>;
  org?: Org;
};

/** A signed PERMANENT/EXPIRING credential in a sealed, ANCHORED cohort batch. */
export async function cohortBuilt(o: CohortOptions = {}): Promise<Built> {
  const org = o.org ?? mkOrg();
  const wallet = o.wallet ?? freshWallet();
  const lifecycle = o.lifecycle ?? "PERMANENT";
  const issuedAt = o.issuedAt ?? ISSUED_AT;
  const key = mkKey(org, wallet, o.keyOver);
  const material = await signMaterial({ org, wallet, key, lifecycle, issuedAt });
  const ev = baseEvidence(org, material);

  const leaf: CohortLeafInput = {
    orgId: org.orgId,
    credentialId: material.credentialId,
    subjectCommitment: material.subjectCommitment,
    contentDigest: material.contentDigest,
    lifecycleType: LIFECYCLE_CODE[lifecycle],
    validFrom: dateToUnixSeconds(material.validFrom),
    validUntil: material.validUntil ? dateToUnixSeconds(material.validUntil) : 0n,
    issuedAt: dateToUnixSeconds(issuedAt),
    schemaId: SCHEMA_ID,
  };
  const fillers: CohortLeafInput[] = Array.from({ length: o.fillers ?? 2 }, () => ({ ...leaf, credentialId: b32(), subjectCommitment: b32(), contentDigest: b32() }));
  const tree = buildCohortTree([leaf, ...fillers]);
  const mine = tree.entries.find((e) => e.credentialId === material.credentialId)!;

  const anchoredAt = o.anchoredAt === undefined ? addMs(issuedAt, 2 * DAY) : o.anchoredAt;
  let anchors: AnchorEvidence[] = [];
  let anchor: AnchorEvidence | null = null;
  if (anchoredAt) {
    const epoch = o.epoch ?? 1;
    anchors = priorChain(org, "COHORT", epoch, addMs(issuedAt, -DAY));
    anchor = mkAnchor({
      org,
      type: "COHORT",
      epoch,
      batchRoot: tree.root,
      previousChainRoot: anchors.length ? anchors[anchors.length - 1].chainRoot : ZERO_HASH,
      at: anchoredAt,
      leafCount: tree.leafCount,
      status: o.anchorStatus,
    });
    anchors.push(anchor);
  }
  ev.cohort = {
    leafHash: cohortLeafHash(leaf),
    proof: { siblings: mine.proof.siblings },
    batch: { status: anchor ? "ANCHORED" : "SEALED", batchRoot: tree.root, leafCount: tree.leafCount, anchorId: anchor?.id ?? null },
  };
  ev.anchors = anchors;
  return { org, wallet, material, ev, policy: POLICY };
}

export type PulseStep =
  | { t: "filler" }
  | { t: "insert" }
  | { t: "anchor"; at: Date; status?: TxEvidence["status"] }
  | { t: "end"; issuedAt: Date; effectiveAt: Date };

export type PulseOptions = { issuedAt?: Date; steps?: PulseStep[]; wallet?: TestWallet; keyOver?: Partial<KeyEvidence>; org?: Org; depth?: number };

/** A signed CONTINUING credential inserted in a ProofPulse tree, with the given timeline of events. */
export async function pulseBuilt(o: PulseOptions = {}): Promise<Built> {
  const org = o.org ?? mkOrg();
  const wallet = o.wallet ?? freshWallet();
  const issuedAt = o.issuedAt ?? ISSUED_AT;
  const key = mkKey(org, wallet, o.keyOver);
  const material = await signMaterial({ org, wallet, key, lifecycle: "CONTINUING", issuedAt });
  const ev = baseEvidence(org, material);
  const depth = o.depth ?? 6;
  const steps = o.steps ?? [{ t: "insert" }, { t: "anchor", at: addMs(issuedAt, 2 * DAY) }];

  const tree = new SparsePulseTree(depth);
  const log: PulseEvidence["log"] = [];
  const anchors: AnchorEvidence[] = [];
  const statusChanges: AttestationEvidence[] = [];
  let myIndex = -1;
  let nextIndex = 0;
  let previousRoot: string | null = null;
  let previousChain = ZERO_HASH;
  const push = (kind: "INSERT" | "STATUS_CHANGE", leafIndex: number, leafHash: string, causedBy: string) => {
    const newRoot = tree.setLeaf(leafIndex, leafHash);
    log.push({ rootSeq: log.length + 1, kind, leafIndex, newLeafHash: leafHash, previousRoot: previousRoot ?? emptyPulseRoot(depth), newRoot, causedByAttestationId: causedBy });
    previousRoot = newRoot;
  };

  for (const step of steps) {
    if (step.t === "filler") {
      push("INSERT", nextIndex++, b32(), randomUUID());
    } else if (step.t === "insert") {
      myIndex = nextIndex++;
      push(
        "INSERT",
        myIndex,
        pulseLeafHash({
          orgId: org.orgId,
          leafIndex: myIndex,
          credentialId: material.credentialId,
          subjectCommitment: material.subjectCommitment,
          contentDigest: material.contentDigest,
          scope: SCOPE_CODE.EMPLOYMENT,
          status: PULSE_STATUS_CODE.ACTIVE,
          statusEffectiveAt: dateToUnixSeconds(material.validFrom),
          statusSeq: 1,
        }),
        material.attestation.id,
      );
    } else if (step.t === "end") {
      const nonce = b32();
      const typed = buildStatusChangeTypedData(farjiDomain(TEST_CONFIG), {
        credentialId: material.credentialId,
        orgId: org.orgId,
        leafIndex: myIndex,
        newStatus: PULSE_STATUS_CODE.ENDED,
        effectiveAt: dateToUnixSeconds(step.effectiveAt),
        statusSeq: 2,
        issuedAt: dateToUnixSeconds(step.issuedAt),
        nonce,
      });
      const att: AttestationEvidence = {
        id: randomUUID(),
        organisationId: org.id,
        signature: (await wallet.signTypedData(typed.domain, typed.types, typed.message)).toLowerCase(),
        typedDataHash: typedDataHash(typed),
        nonce,
        issuedAt: step.issuedAt,
        chainId: Number(TEST_CONFIG.chainId),
        verifyingContract: TEST_CONFIG.verifyingContract,
        signerKey: key,
        statusSeq: 2,
        newStatus: "ENDED",
        effectiveAt: step.effectiveAt,
      };
      statusChanges.push(att);
      push(
        "STATUS_CHANGE",
        myIndex,
        pulseLeafHash({
          orgId: org.orgId,
          leafIndex: myIndex,
          credentialId: material.credentialId,
          subjectCommitment: material.subjectCommitment,
          contentDigest: material.contentDigest,
          scope: SCOPE_CODE.EMPLOYMENT,
          status: PULSE_STATUS_CODE.ENDED,
          statusEffectiveAt: dateToUnixSeconds(step.effectiveAt),
          statusSeq: 2,
        }),
        att.id,
      );
    } else {
      const a = mkAnchor({ org, type: "PROOF_PULSE", epoch: anchors.length + 1, batchRoot: tree.root, previousChainRoot: previousChain, at: step.at, rootSeq: log.length, leafCount: nextIndex, status: step.status });
      anchors.push(a);
      previousChain = a.chainRoot;
    }
  }
  ev.pulse = { depth, leaf: { leafIndex: myIndex, scope: "EMPLOYMENT" }, log };
  ev.anchors = anchors;
  ev.statusChanges = statusChanges;
  return { org, wallet, material, ev, policy: POLICY };
}

/** A copy of `ev` with changes applied (Dates and nested objects are shared; tests replace, never mutate in place). */
export const patched = (ev: CredentialEvidence, patch: Partial<CredentialEvidence>): CredentialEvidence => ({ ...ev, ...patch });
export const withMaterial = (ev: CredentialEvidence, patch: Partial<SignedMaterial>): CredentialEvidence => patched(ev, { signed: { ...ev.signed!, ...patch } });
export const withAnchor = (ev: CredentialEvidence, index: number, patch: Partial<AnchorEvidence>): CredentialEvidence => {
  const anchors = ev.anchors.map((a, i) => (i === index ? { ...a, ...patch } : a));
  return patched(ev, { anchors });
};
