import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

const sections = [
  {
    title: "Issuer Registry",
    explanation:
      "Tracks which organisations exist and which wallet addresses are currently authorised to attest on their behalf. Blockchain only proves a wallet signed something — this registry is what lets a verifier trust that the wallet belongs to a real, admin-approved organisation.",
    functions: ["registerOrganisation()", "authoriseIssuer()"],
    snippet: `function authoriseIssuer(
    bytes32 organisationId,
    address wallet,
    uint64 validFrom
) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(organisations[organisationId].registered, "Unknown organisation");
    require(issuerRecords[wallet].wallet == address(0), "Wallet already registered");

    issuerRecords[wallet] = IssuerKeyRecord({
        organisationId: organisationId,
        wallet: wallet,
        validFrom: validFrom,
        validUntil: 0,
        revoked: false
    });
    issuerWalletsByOrg[organisationId].push(wallet);

    emit IssuerAuthorised(organisationId, wallet, validFrom);
}`,
  },
  {
    title: "Key Rotation",
    explanation:
      "If an institution's signing key is lost or compromised, the old wallet is revoked for future use while a new wallet takes over — but historical credentials are still checked against whichever wallet was valid at the time they were signed, not the wallet's current status.",
    functions: ["rotateIssuerKey()", "isIssuerValidAt()"],
    snippet: `function isIssuerValidAt(address wallet, uint64 timestamp) public view returns (bool) {
    IssuerKeyRecord memory record = issuerRecords[wallet];
    if (record.wallet == address(0)) return false;
    if (timestamp < record.validFrom) return false;
    if (record.validUntil != 0 && timestamp >= record.validUntil) return false;
    return true;
}`,
  },
  {
    title: "Attestation Anchoring",
    explanation:
      "Records a Merkle batch root (from a CohortProof or ProofPulse batch) on-chain, chained to the organisation's previous attestation via the chainRoot formula, so a skipped or forged epoch becomes detectable.",
    functions: ["anchorAttestation()"],
    snippet: `require(previousChainRoot == currentChainRoot[organisationId][attestationType],
    "Invalid previous chain root");

bytes32 chainRoot = keccak256(
    abi.encode(batchRoot, previousChainRoot, organisationId, attestationType, epoch)
);`,
  },
  {
    title: "Credential Revocation",
    explanation:
      "Lets an authorised issuer mark a specific credential as revoked. Revocation never deletes history — it adds a public, permanent negative assertion that a verifier checks separately from the credential's original signature.",
    functions: ["revokeCredential()", "isCredentialRevoked()"],
    snippet: `function revokeCredential(bytes32 credentialId) external {
    require(isIssuerValidAt(msg.sender, uint64(block.timestamp)),
        "Caller is not a currently authorised issuer");
    require(!revocations[credentialId].revoked, "Credential already revoked");

    revocations[credentialId] = RevocationRecord({
        revoked: true,
        revokedAt: uint64(block.timestamp),
        issuer: msg.sender
    });

    emit CredentialRevoked(credentialId, msg.sender, uint64(block.timestamp));
}`,
  },
  {
    title: "ProofPulse",
    explanation:
      "Not a separate contract feature — ProofPulse batches are anchored through the same anchorAttestation() function, tagged with attestationType = PROOF_PULSE, so continuing claims (like current employment) can be freshness-checked against the latest epoch.",
    functions: ["anchorAttestation(..., PROOF_PULSE, ...)"],
    snippet: `enum AttestationType {
    COHORT,
    PROOF_PULSE
}`,
  },
  {
    title: "CohortProof",
    explanation:
      "Also anchored through anchorAttestation(), tagged attestationType = COHORT — one attestation covers an entire graduating cohort instead of one transaction per student.",
    functions: ["anchorAttestation(..., COHORT, ...)"],
    snippet: `struct Attestation {
    bytes32 organisationId;
    AttestationType attestationType;
    uint64 epoch;
    bytes32 batchRoot;
    bytes32 previousChainRoot;
    bytes32 chainRoot;
    uint64 anchoredAt;
    address issuerWallet;
}`,
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
            <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
              {section.snippet}
            </pre>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-slate-400">
        Full function-by-function explanations: <code className="rounded bg-slate-100 px-1">docs/SOLIDITY_EXPLANATION.md</code>.
        Likely viva questions and answers: <code className="rounded bg-slate-100 px-1">docs/SOLIDITY_VIVA.md</code>.
      </p>
    </div>
  );
}
