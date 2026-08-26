import { mockHex as hex, GENESIS_ROOT } from "./mockHex";

// Dedicated illustrative dataset for the /proofpulse walkthrough page.
// "Credential B" is deliberately Aarav Sharma's real CRED-002 employment
// claim, so the demo page ties back to what the Candidate Dashboard shows.
export interface ProofPulseLeaf {
  id: string;
  label: string;
  /** Links back to a real mock credential shown elsewhere in the demo, if any. */
  credentialId?: string;
}

export const augustLeaves: ProofPulseLeaf[] = [
  { id: "PP-A", label: "Credential A" },
  { id: "PP-B", label: "Credential B — Aarav Sharma, Software Engineer", credentialId: "CRED-002" },
  { id: "PP-C", label: "Credential C" },
  { id: "PP-D", label: "Credential D" },
];

// September's active set omits Credential B. Per the project's core
// design rule, this must read as "not recently re-attested," never as
// "employment ended" — that transition requires a separate explicit action.
export const septemberLeaves: ProofPulseLeaf[] = augustLeaves.filter(
  (leaf) => leaf.id !== "PP-B",
);

export const augustAttestation = {
  label: "August 2026 ProofPulse",
  batchRoot: hex("f1"),
  previousChainRoot: GENESIS_ROOT,
  chainRoot: hex("f2"),
  anchoredAt: "2026-08-01",
};

export const septemberAttestation = {
  label: "September 2026 ProofPulse",
  batchRoot: hex("f3"),
  previousChainRoot: augustAttestation.chainRoot,
  chainRoot: hex("f4"),
  anchoredAt: "2026-09-01",
};
