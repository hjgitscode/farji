import type { VerificationCheck } from "./types";

// Presentation-only grouping of the engine's checks for the public verifier. Nothing is added, removed or re-judged: every check
// stays in its group (unknown ids fall into the last one) and a group is only as good as its weakest check.

export type GroupStatus = "PASS" | "FAIL" | "PENDING";

export type EvidenceGroup = { id: string; title: string; summary: string; icon: "pen" | "key" | "file" | "layers" | "anchor" | "history"; status: GroupStatus; checks: VerificationCheck[] };

const DEFS: { id: string; title: string; summary: string; icon: EvidenceGroup["icon"]; ids: string[] }[] = [
  { id: "signature", title: "Issuer signature", summary: "The record was signed by the issuing organisation's wallet.", icon: "pen", ids: ["ATTESTATION_PRESENT", "SIGNED_MESSAGE", "SIGNATURE", "SIGNER_ORGANISATION", "CREDENTIAL_ID"] },
  {
    id: "authority",
    title: "Issuer authorisation",
    summary: "That wallet was authorised for the organisation when it signed, and was not compromised.",
    icon: "key",
    ids: ["SIGNER_AUTHORISED_AT_ISSUANCE", "SIGNER_AUTHORISATION_FINAL", "SIGNER_NOT_COMPROMISED_AT_ANCHOR"],
  },
  { id: "integrity", title: "Record integrity", summary: "The record's content, dates and holder match what was signed.", icon: "file", ids: ["CANONICAL_CONTENT", "CONTENT_DIGEST", "SUBJECT_COMMITMENT", "CREDENTIAL_DATES"] },
  { id: "inclusion", title: "Merkle inclusion proof", summary: "The signed record is part of the batch that was anchored.", icon: "layers", ids: ["MERKLE_LEAF", "MERKLE_PROOF", "ANCHOR_ROOT"] },
  {
    id: "anchor",
    title: "Finalized blockchain anchor",
    summary: "The batch is recorded on the public network and is final.",
    icon: "anchor",
    ids: ["ANCHOR_FINAL", "ANCHOR_ORGANISATION", "ANCHOR_CHAIN", "ANCHOR_CHAIN_CONTINUITY", "ANCHOR_WINDOW"],
  },
  { id: "lifecycle", title: "Lifecycle and revocation", summary: "Whether the record is current, ended, expired or withdrawn.", icon: "history", ids: [] },
];

export function groupChecks(checks: readonly VerificationCheck[]): EvidenceGroup[] {
  const known = new Set(DEFS.flatMap((d) => d.ids));
  const groups = DEFS.map((d) => ({
    ...d,
    checks: checks.filter((c) => (d.id === "lifecycle" ? !known.has(c.id) : d.ids.includes(c.id))),
  }));
  return groups
    .filter((g) => g.checks.length > 0)
    .map((g) => {
      const applicable = g.checks.filter((c) => c.status !== "NOT_APPLICABLE");
      const status: GroupStatus = applicable.some((c) => c.status === "FAIL") ? "FAIL" : applicable.some((c) => c.status === "PENDING") ? "PENDING" : "PASS";
      return { id: g.id, title: g.title, summary: g.summary, icon: g.icon, status, checks: g.checks };
    });
}
