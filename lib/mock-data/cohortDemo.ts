import { mockHex as hex, GENESIS_ROOT } from "./mockHex";

// Dedicated illustrative dataset for the /cohortproof walkthrough page.
// "Student A" is deliberately Aarav Sharma's real CRED-001 degree claim,
// so the demo page ties back to the Candidate Dashboard.
export interface CohortLeaf {
  id: string;
  label: string;
  credentialId?: string;
}

export const cohortStudents: CohortLeaf[] = [
  { id: "STU-A", label: "Student A — Aarav Sharma, B.Tech Computer Science", credentialId: "CRED-001" },
  { id: "STU-B", label: "Student B" },
  { id: "STU-C", label: "Student C" },
  { id: "STU-D", label: "Student D" },
];

export const cohortAttestation = {
  label: "2026 Graduation Cohort",
  batchRoot: hex("d1"),
  previousChainRoot: GENESIS_ROOT,
  chainRoot: hex("d2"),
  anchoredAt: "2026-06-05",
};

// Student B's individual Merkle proof: the sibling hashes needed to
// recompute the cohort root from Student B's own leaf. Illustrative only
// until the real Merkle engine (Phase 8) generates actual proofs.
export const studentBProof = {
  leaf: cohortStudents[1],
  siblingHashes: [hex("e1"), hex("e2")],
  recomputedRoot: cohortAttestation.batchRoot,
};
