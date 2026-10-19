import { writeFileSync } from "node:fs";
import path from "node:path";
import { TypedDataEncoder } from "ethers";
import { it } from "vitest";
import { canonicalCredentialContent } from "@/lib/crypto/canonical";
import { chainRootOf } from "@/lib/crypto/chain-root";
import { areDistinctSalts, contentDigestOf, credentialIdOf, subjectCommitmentOf } from "@/lib/crypto/commitments";
import * as K from "@/lib/crypto/constants";
import { isoDateToUnixSeconds, uuidToBytes16 } from "@/lib/crypto/encoding";
import { buildCredentialTypedData, buildStatusChangeTypedData, farjiDomain, recoverSigner, typedDataHash } from "@/lib/crypto/eip712";
import { buildCohortTree, cohortLeafHash } from "@/lib/merkle/cohort";
import { emptyPulseRoot, pulseLeafHash, pulseNodeHash, SparsePulseTree, zeroHashes } from "@/lib/merkle/pulse";
import { deterministicWallet } from "../fixtures/test-wallets";
import { rep, V } from "./inputs";

// One-off generator for tests/vectors/crypto.json. Run explicitly with GENERATE_VECTORS=1.
it.runIf(process.env.GENERATE_VECTORS === "1")("generate golden vectors", async () => {
  const canonical = canonicalCredentialContent(V.category, V.lifecycle, V.content);
  if (!canonical.ok) throw new Error("bad inputs");
  const domain = farjiDomain({ chainId: V.chainId, verifyingContract: V.verifyingContract });
  const credentialId = credentialIdOf(V.orgId, V.credentialSalt);
  const subjectCommitment = subjectCommitmentOf(uuidToBytes16(V.subjectUuid), V.subjectSalt);
  const contentDigest = contentDigestOf(canonical.value, V.contentSalt);
  const td = buildCredentialTypedData(domain, {
    credentialId,
    orgId: V.orgId,
    subjectCommitment,
    content: canonical.value,
    contentSalt: V.contentSalt,
    lifecycleType: K.LIFECYCLE_CODE.PERMANENT,
    validFrom: V.validFrom,
    validUntil: V.validUntil,
    supersedesCredentialId: K.ZERO_HASH,
    issuedAt: V.issuedAt,
    nonce: V.nonce,
  });
  const wallet = deterministicWallet();
  const signature = (await wallet.signTypedData(td.domain, td.types, td.message)).toLowerCase();
  const sc = buildStatusChangeTypedData(domain, {
    credentialId,
    orgId: V.orgId,
    leafIndex: V.leafIndex,
    newStatus: K.PULSE_STATUS_CODE.ENDED,
    effectiveAt: V.effectiveAt,
    statusSeq: V.statusSeq,
    issuedAt: V.issuedAt,
    nonce: V.nonce,
  });

  // ProofPulse (depth 3)
  const depth = 3;
  const common = { orgId: V.orgId, subjectCommitment, contentDigest, scope: K.SCOPE_CODE.EMPLOYMENT };
  const leafA = pulseLeafHash({ ...common, leafIndex: 0, credentialId: rep("a1"), status: 0, statusEffectiveAt: V.validFrom, statusSeq: 1 });
  const leafB = pulseLeafHash({ ...common, leafIndex: 1, credentialId: rep("b2"), status: 0, statusEffectiveAt: V.validFrom, statusSeq: 1 });
  const leafAEnded = pulseLeafHash({ ...common, leafIndex: 0, credentialId: rep("a1"), status: 1, statusEffectiveAt: V.effectiveAt, statusSeq: 2 });
  const tree = new SparsePulseTree(depth);
  const rootAfterA = tree.setLeaf(0, leafA);
  const rootAfterB = tree.setLeaf(1, leafB);
  const rootAfterEnd = tree.setLeaf(0, leafAEnded);

  // CohortProof (3 leaves)
  const cohortInputs = ["01", "02", "03"].map((b) => ({
    orgId: V.orgId,
    credentialId: rep(b),
    subjectCommitment,
    contentDigest,
    lifecycleType: K.LIFECYCLE_CODE.PERMANENT,
    validFrom: V.validFrom,
    validUntil: V.validUntil,
    issuedAt: V.issuedAt,
    schemaId: K.SCHEMA_ID,
  }));
  const cohort = buildCohortTree(cohortInputs);

  const out = {
    note: "Golden vectors for FARJI Phase 6/7. Phase 8 Solidity tests must reproduce them from tests/vectors/inputs.ts.",
    tags: {
      CREDENTIAL_ID_TAG: K.CREDENTIAL_ID_TAG,
      SUBJECT_TAG: K.SUBJECT_TAG,
      COHORT_LEAF_V1: K.COHORT_LEAF_V1,
      PULSE_LEAF_V1: K.PULSE_LEAF_V1,
      PULSE_NODE_V1: K.PULSE_NODE_V1,
      PULSE_EMPTY_V1: K.PULSE_EMPTY_V1,
    },
    schema: { encodeType: TypedDataEncoder.from(K.CONTENT_TYPES).encodeType("CredentialContent"), schemaId: K.SCHEMA_ID },
    distinctSalts: areDistinctSalts(V.credentialSalt, V.contentSalt, V.subjectSalt),
    credentialId,
    subjectCommitment,
    contentDigest,
    domainSeparator: TypedDataEncoder.hashDomain(domain),
    credentialAttestation: { typedDataHash: typedDataHash(td), signature, signer: recoverSigner(td, signature) },
    statusChangeAttestation: { typedDataHash: typedDataHash(sc) },
    chainRoot: chainRootOf(V.batchRoot, V.previousChainRoot, V.orgId, "COHORT", V.epoch),
    chainRootProofPulse: chainRootOf(V.batchRoot, V.previousChainRoot, V.orgId, "PROOF_PULSE", V.epoch),
    pulse: {
      depth,
      zeroHashes: zeroHashes(depth),
      emptyRoot: emptyPulseRoot(depth),
      nodeOfZeros: pulseNodeHash(zeroHashes(depth)[0], zeroHashes(depth)[0]),
      leafA,
      leafB,
      leafAEnded,
      rootAfterA,
      rootAfterB,
      rootAfterEnd,
      proofOfB: tree.proof(1),
    },
    cohort: {
      leafHashes: cohortInputs.map((i) => cohortLeafHash(i)),
      root: cohort.root,
      entries: cohort.entries,
    },
  };
  writeFileSync(path.join(__dirname, "crypto.json"), JSON.stringify(out, null, 2) + "\n");
  void isoDateToUnixSeconds;
});
