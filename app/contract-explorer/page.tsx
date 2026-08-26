import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

const sections = [
  {
    title: "Issuer Registry",
    explanation:
      "Tracks which organisations exist and which wallet addresses are currently authorised to attest on their behalf. Blockchain only proves a wallet signed something — this registry is what lets a verifier trust that the wallet belongs to a real, admin-approved organisation.",
    functions: ["registerOrganisation()", "authoriseIssuer()"],
  },
  {
    title: "Key Rotation",
    explanation:
      "If an institution's signing key is lost or compromised, the old wallet is revoked for future use while a new wallet takes over — but historical credentials are still checked against whichever wallet was valid at the time they were signed, not the wallet's current status.",
    functions: ["rotateIssuerKey()", "isIssuerValidAt()"],
  },
  {
    title: "Attestation Anchoring",
    explanation:
      "Records a Merkle batch root (from a CohortProof or ProofPulse batch) on-chain, chained to the organisation's previous attestation via the chainRoot formula, so a skipped or forged epoch becomes detectable.",
    functions: ["anchorAttestation()"],
  },
  {
    title: "Credential Revocation",
    explanation:
      "Lets an authorised issuer mark a specific credential as revoked. Revocation never deletes history — it adds a public, permanent negative assertion that a verifier checks separately from the credential's original signature.",
    functions: ["revokeCredential()", "isCredentialRevoked()"],
  },
  {
    title: "ProofPulse",
    explanation:
      "Not a separate contract feature — ProofPulse batches are anchored through the same anchorAttestation() function, tagged with attestationType = PROOF_PULSE, so continuing claims (like current employment) can be freshness-checked against the latest epoch.",
    functions: ["anchorAttestation(..., PROOF_PULSE, ...)"],
  },
  {
    title: "CohortProof",
    explanation:
      "Also anchored through anchorAttestation(), tagged attestationType = COHORT — one attestation covers an entire graduating cohort instead of one transaction per student.",
    functions: ["anchorAttestation(..., COHORT, ...)"],
  },
];

export default function ContractExplorerPage() {
  return (
    <div>
      <PageHeader
        title="Smart Contract Explorer"
        subtitle="A guided tour of NotSoFarjiRegistry.sol for academic demonstration. No private keys are shown here."
      />
      <div className="space-y-4">
        {sections.map((section) => (
          <Card key={section.title}>
            <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{section.explanation}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {section.functions.map((fn) => (
                <code key={fn} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                  {fn}
                </code>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-400">
              Solidity source snippet — added once the contract is written (Phase 6) and fully
              explained in <code className="rounded bg-slate-100 px-1">docs/SOLIDITY_EXPLANATION.md</code>{" "}
              (Phase 14).
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
