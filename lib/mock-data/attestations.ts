import { DEMO_WALLETS } from "@/lib/crypto/demoWallets";
import type { Attestation } from "./types";
import { mockHex as hex, GENESIS_ROOT } from "./mockHex";

// Mock bytes32-shaped hex values. These are illustrative placeholders —
// real Keccak-256 Merkle roots and chained hashes are computed starting
// in Phase 8 (Merkle engine) and Phase 11 (chained attestations).

export const attestations: Attestation[] = [
  {
    attestationId: "COHORT-IITD-2026-1",
    organisationId: "ORG-IITD",
    attestationType: "COHORT",
    epoch: 1,
    label: "2026 Graduation Cohort",
    leafCredentialIds: ["CRED-001", "CRED-STUDENT-B", "CRED-STUDENT-C", "CRED-STUDENT-D"],
    batchRoot: hex("a1"),
    previousChainRoot: GENESIS_ROOT,
    chainRoot: hex("a2"),
    anchoredAt: "2026-06-05",
    issuerWallet: DEMO_WALLETS.IITD.address,
  },
  {
    attestationId: "PROOFPULSE-XYZ-2026-08",
    organisationId: "ORG-XYZ",
    attestationType: "PROOF_PULSE",
    epoch: 1,
    label: "August 2026 ProofPulse",
    leafCredentialIds: ["CRED-A", "CRED-002", "CRED-C", "CRED-D"],
    batchRoot: hex("b1"),
    previousChainRoot: GENESIS_ROOT,
    chainRoot: hex("b2"),
    anchoredAt: "2026-08-01",
    // XYZ's key rotation happens Jan 2027 (see issuerKeys.ts) — both this
    // epoch and September's are anchored before that, so they're signed
    // by the original wallet, not the post-rotation one.
    issuerWallet: DEMO_WALLETS.XYZ_ORIGINAL.address,
  },
  {
    attestationId: "PROOFPULSE-XYZ-2026-09",
    organisationId: "ORG-XYZ",
    attestationType: "PROOF_PULSE",
    epoch: 2,
    label: "September 2026 ProofPulse",
    // CRED-002 (Aarav Sharma) stays a member of the "official" record here —
    // credentials.ts marks it CURRENTLY_ATTESTED, so the batch it's cited
    // against must actually include it. The /proofpulse page's illustrative
    // Credential A/B/C/D walkthrough is a deliberately separate, self-
    // contained narrative (lib/mock-data/proofPulseDemo.ts) showing what
    // staleness would look like — it does not read from this file.
    leafCredentialIds: ["CRED-A", "CRED-002", "CRED-C", "CRED-D"],
    batchRoot: hex("c1"),
    previousChainRoot: hex("b2"),
    chainRoot: hex("c2"),
    anchoredAt: "2026-09-01",
    issuerWallet: DEMO_WALLETS.XYZ_ORIGINAL.address,
  },
];
