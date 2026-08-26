import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";

const layers = [
  { title: "Candidate / Issuer / Admin", detail: "The three people who use NotSoFarji." },
  { title: "NotSoFarji Application", detail: "Next.js UI, dashboards, and the public verification page." },
  {
    title: "Cryptographic Layer",
    detail: "Canonicalisation, Keccak-256 hashing, EIP-712 signing, Merkle tree/proof engine.",
  },
  {
    title: "Solidity Smart Contract",
    detail: "NotSoFarjiRegistry.sol — issuer registry, attestation anchoring, revocation.",
  },
  { title: "EVM Blockchain", detail: "Local Hardhat network for Review 2." },
];

const reviewThree = [
  "Supabase (PostgreSQL) replacing mock data, behind the same service layer",
  "Supabase Authentication for candidate/issuer/admin accounts",
  "Deployment to a public testnet (Ethereum Sepolia or Polygon Amoy)",
  "Production issuer key management (ideally HSM-backed)",
  "Real institutional ERP / student-information-system integration",
  "LinkedIn integration, where API permissions allow",
  "Vercel production deployment",
];

export default function TechnologyPage() {
  return (
    <div>
      <PageHeader
        title="Technology & Architecture"
        subtitle="Blockchain is not the authority for real-world truth — the issuer is. The chain preserves tamper-evident evidence of what an authorised issuer attested, and when."
      />

      <div className="mx-auto max-w-md space-y-2">
        {layers.map((layer, index) => (
          <div key={layer.title}>
            <Card>
              <p className="font-semibold text-slate-900">{layer.title}</p>
              <p className="text-sm text-slate-500">{layer.detail}</p>
            </Card>
            {index < layers.length - 1 && <div className="py-1 text-center text-slate-300">↓</div>}
          </div>
        ))}
      </div>

      <div className="mt-12">
        <h2 className="text-xl font-semibold text-slate-900">
          <Badge tone="amber">Future implementation</Badge>{" "}
          <span className="ml-2 align-middle">Review 3</span>
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Review 2 is a local prototype. The items below are deliberately out of scope for now —
          see <code className="rounded bg-slate-100 px-1">docs/REVIEW3_FUTURE_WORK.md</code> for
          the full rationale.
        </p>
        <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-slate-600">
          {reviewThree.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
