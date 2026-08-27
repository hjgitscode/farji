import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MerkleTreeVisual } from "@/components/merkle/MerkleTreeVisual";
import { buildCohortBatch, getStudentProof } from "@/lib/services/cohortService";

function truncateHex(hex: string) {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

export default function CohortProofPage() {
  const batch = buildCohortBatch();
  const studentBProof = getStudentProof("STU-B");

  return (
    <div className="space-y-6">
      <PageHeader
        title="CohortProof"
        subtitle="One Merkle-batched attestation covering an entire graduating cohort, replacing thousands of individual verification requests with one institutional action plus per-candidate proofs."
      />

      <MerkleTreeVisual
        title={batch.label}
        leaves={batch.leaves}
        batchRoot={batch.root}
        anchoredAt={batch.anchoredAt}
        highlightLeafId={studentBProof?.leaf.id}
      />

      {studentBProof && (
        <Card>
          <p className="font-semibold text-slate-900">Verify Student B&apos;s individual proof</p>
          <p className="mt-1 text-sm text-slate-500">
            Student B does not need the whole cohort list — only their own leaf plus the sibling
            hashes below are enough to recompute the same root the university anchored on-chain.
            This is a real Merkle proof, computed by lib/merkle from the batch above.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-brand">Show Merkle proof</summary>
            <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
              <dt>Leaf</dt>
              <dd>{studentBProof.leaf.label}</dd>
              <dt>Leaf hash</dt>
              <dd className="font-mono">{truncateHex(studentBProof.leafHash)}</dd>
              <dt>Sibling hashes (proof)</dt>
              <dd className="font-mono">{studentBProof.proof.map(truncateHex).join(", ")}</dd>
              <dt>Anchored cohort root</dt>
              <dd className="font-mono">{truncateHex(studentBProof.root)}</dd>
            </dl>
            <div className="mt-3">
              <Badge tone={studentBProof.valid ? "green" : "red"}>
                {studentBProof.valid ? "VALID" : "INVALID"}
              </Badge>
            </div>
          </details>
        </Card>
      )}
    </div>
  );
}
