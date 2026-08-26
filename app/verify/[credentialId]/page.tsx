import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/credential/StatusBadge";
import { LifecycleBadge } from "@/components/credential/LifecycleBadge";
import { buildVerificationResult } from "@/lib/services/verificationService";

function truncateHex(hex: string) {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

function boolBadge(value: boolean | null, trueLabel: string, falseLabel: string) {
  if (value === null) return <Badge tone="gray">—</Badge>;
  return <Badge tone={value ? "green" : "red"}>{value ? trueLabel : falseLabel}</Badge>;
}

export default function VerificationReportPage({ params }: { params: { credentialId: string } }) {
  const result = buildVerificationResult(params.credentialId);

  if (!result) {
    return (
      <div>
        <PageHeader title="Credential not found" />
        <p className="text-sm text-slate-500">
          No credential exists with id <code className="rounded bg-slate-100 px-1">{params.credentialId}</code>.
        </p>
      </div>
    );
  }

  const { credential, organisation, technicalProof } = result;

  return (
    <div className="space-y-6">
      <PageHeader
        title={credential.title}
        subtitle={`${organisation?.name ?? credential.organisationId} · Credential ID ${credential.credentialId}`}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <LifecycleBadge type={credential.lifecycleType} />
          <StatusBadge state={result.currentState} />
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Issuer Signature</dt>
            <dd>{boolBadge(result.issuerSignatureValid, "VALID", "INVALID")}</dd>
          </div>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Claim Integrity</dt>
            <dd>{boolBadge(result.claimIntegrityUnchanged, "UNCHANGED", "MODIFIED")}</dd>
          </div>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Issuer Authorised at Issuance</dt>
            <dd>{boolBadge(result.issuerAuthorisedAtIssuance, "YES", "NO")}</dd>
          </div>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Cohort Proof</dt>
            <dd>
              <Badge tone={result.cohortProof === "VALID" ? "green" : "gray"}>{result.cohortProof}</Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Latest ProofPulse</dt>
            <dd>
              <Badge tone={result.latestProofPulse === "CURRENT" ? "green" : result.latestProofPulse === "STALE" ? "amber" : "gray"}>
                {result.latestProofPulse}
              </Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Blockchain Anchor</dt>
            <dd>
              <Badge tone={result.blockchainAnchor === "CONFIRMED" ? "green" : "gray"}>
                {result.blockchainAnchor === "CONFIRMED" ? "CONFIRMED" : "NOT YET ANCHORED"}
              </Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Historical Chain</dt>
            <dd>{boolBadge(result.historicalChainIntact, "INTACT", "BROKEN")}</dd>
          </div>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Revocation</dt>
            <dd>
              <Badge tone={result.revoked ? "red" : "green"}>{result.revoked ? "YES" : "NO"}</Badge>
            </dd>
          </div>
        </dl>

        <div className="mt-4 rounded-md bg-slate-50 p-3 text-center">
          <p className="text-xs uppercase tracking-wide text-slate-400">Current Verification State</p>
          <div className="mt-1">
            <StatusBadge state={result.currentState} />
          </div>
        </div>
      </Card>

      {technicalProof && (
        <Card>
          <details>
            <summary className="cursor-pointer font-semibold text-slate-900">Technical Proof</summary>
            <p className="mt-2 text-xs text-slate-400">
              Claim hash is real Keccak-256 (Phase 4). Signature and Merkle proof are still
              illustrative placeholders, wired up in Phases 5 and 8.
            </p>
            <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs text-slate-600 sm:grid-cols-2">
              <dt>Claim hash</dt>
              <dd className="font-mono">{truncateHex(technicalProof.claimHash)}</dd>
              <dt>Issuer wallet</dt>
              <dd className="font-mono">{truncateHex(technicalProof.issuerWallet)}</dd>
              <dt>Signature</dt>
              <dd className="font-mono">{truncateHex(technicalProof.signature)}</dd>
              {technicalProof.merkleRoot && (
                <>
                  <dt>Merkle root</dt>
                  <dd className="font-mono">{truncateHex(technicalProof.merkleRoot)}</dd>
                  <dt>Merkle proof</dt>
                  <dd className="font-mono">{technicalProof.merkleProof.map(truncateHex).join(", ")}</dd>
                  <dt>Batch epoch</dt>
                  <dd>{technicalProof.batchEpoch}</dd>
                  <dt>Previous chain root</dt>
                  <dd className="font-mono">
                    {technicalProof.previousChainRoot && truncateHex(technicalProof.previousChainRoot)}
                  </dd>
                  <dt>Current chain root</dt>
                  <dd className="font-mono">
                    {technicalProof.currentChainRoot && truncateHex(technicalProof.currentChainRoot)}
                  </dd>
                </>
              )}
              <dt>Contract address</dt>
              <dd>{technicalProof.contractAddress}</dd>
              <dt>Chain reference</dt>
              <dd>{technicalProof.chainReference}</dd>
            </dl>
          </details>
        </Card>
      )}
    </div>
  );
}
