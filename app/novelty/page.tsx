import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

const established = [
  "Keccak-256 hashing",
  "ECDSA (secp256k1) digital signatures",
  "EIP-712 typed structured signing",
  "Nonces / replay protection",
  "Merkle trees",
  "Merkle proofs",
  "Blockchain anchoring",
  "Smart contracts",
  "QR-based verification",
  "Revocation and expiration",
];

const contributions = [
  {
    title: "ProofPulse",
    detail:
      "Periodic Merkle-batched re-attestation of currently-active credentials, so continuing claims can be freshness-checked without re-verifying every candidate individually.",
  },
  {
    title: "CohortProof",
    detail:
      "One Merkle-batched attestation covering an entire graduating cohort, replacing thousands of individual verification requests with one institutional action plus per-candidate proofs.",
  },
  {
    title: "Lifecycle-aware credential typing",
    detail:
      "PERMANENT / CONTINUING / EXPIRING claims, with verification state derived by a state machine rather than hand-set.",
  },
  {
    title: "Chained institutional attestations",
    detail:
      "Successive Merkle roots linked into an application-level hash chain per organisation/attestation-stream, for tamper-evident continuity between epochs.",
  },
  {
    title: "Time-aware issuer key history",
    detail:
      "Key rotation where historical signatures remain evaluable against the key's validity window at the time of signing, not the key's current status.",
  },
  {
    title: "Explicit claim versioning",
    detail:
      "Edits never overwrite; they create a new version requiring fresh verification, with the old version preserved as historical evidence.",
  },
  {
    title: "Reduced institutional verification workload",
    detail: "The practical outcome of ProofPulse and CohortProof: one attestation instead of many.",
  },
];

export default function NoveltyPage() {
  return (
    <div>
      <PageHeader
        title="Novelty"
        subtitle="NotSoFarji does not claim to invent cryptographic primitives. It combines established building blocks into an application-level design that addresses a gap in existing systems."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Established technologies</h2>
          <p className="mb-3 text-sm text-slate-500">Not this project&apos;s invention.</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
            {established.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">NotSoFarji design contributions</h2>
          <p className="mb-3 text-sm text-slate-500">What is actually new here.</p>
          <ol className="list-inside list-decimal space-y-3 text-sm text-slate-600">
            {contributions.map((item) => (
              <li key={item.title}>
                <span className="font-medium text-slate-800">{item.title}</span>
                <p className="ml-5 mt-0.5 text-slate-500">{item.detail}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
