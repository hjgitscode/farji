import Link from "next/link";
import { btn, Facts } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { ProofBundle } from "@/lib/verification/bundle";
import type { VerificationResult } from "@/lib/verification/types";

const when = (iso: string | null | undefined) => (iso ? formatDateTime(new Date(iso)) : "");
const NETWORK: Record<string, string> = { "1": "Ethereum mainnet", "11155111": "Ethereum Sepolia test network", "31337": "Local development network" };

/**
 * "View verification details": the technical evidence, collapsed by default. Everything shown is public by design (no salts,
 * no signing nonce, no private content). The plain-language checks come first; identifiers follow.
 */
export function EvidenceDetails({ bundle, result, credentialRef }: { bundle: ProofBundle | null; result: VerificationResult; credentialRef: string }) {
  return (
    <details className="rounded-xl border border-neutral-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-neutral-900">View verification details</summary>
      <div className="mt-4 space-y-5">
        <div>
          <h3 className="mb-2 text-sm font-semibold">What was checked</h3>
          <ul className="space-y-1 text-sm text-neutral-700">
            {result.checks.map((c, i) => (
              <li key={`${c.id}-${i}`} className="flex gap-2">
                <span aria-hidden="true">{c.status === "PASS" ? "✓" : c.status === "FAIL" ? "×" : "…"}</span>
                <span>
                  <span className="sr-only">{c.status === "PASS" ? "Passed: " : c.status === "FAIL" ? "Failed: " : "Waiting: "}</span>
                  {c.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {bundle ? (
          <>
            <Facts
              items={[
                ["Credential identifier", <code key="id" className="break-all text-xs">{bundle.credential.credentialId}</code>],
                ["Issuing organisation", bundle.organisation.name],
                ["Record type", bundle.lifecycle.toLowerCase()],
                ["Signed on", when(bundle.credential.issuedAt)],
                ["Issuer wallet", <code key="w" className="break-all text-xs">{bundle.safeAttestationEvidence.signerWallet}</code>],
                ["Network", NETWORK[bundle.network.chainId] ?? `Chain ${bundle.network.chainId}`],
                ["Registry contract", <code key="r" className="break-all text-xs">{bundle.network.registryContract}</code>],
                ["Evidence type", bundle.anchorEvidence ? (bundle.anchorEvidence.attestationType === "COHORT" ? "Credential batch" : "Current-relationship record") : ""],
                ["Anchored on", when(bundle.anchorEvidence?.anchoredAt as string | null | undefined)],
                ["Anchor sequence", bundle.anchorEvidence ? String(bundle.anchorEvidence.epoch) : ""],
                ["Transaction", bundle.anchorEvidence?.transactionHash ? <code key="t" className="break-all text-xs">{String(bundle.anchorEvidence.transactionHash)}</code> : ""],
                ["Block", bundle.anchorEvidence?.blockNumber ? String(bundle.anchorEvidence.blockNumber) : ""],
              ]}
            />
            <p className="text-xs text-neutral-500">
              Private content and secrets are never published. This evidence lets anyone check the signer, the inclusion proof and the anchor record without them.
            </p>
            <Link href={`/verify/${credentialRef}/bundle`} className={btn.secondary} prefetch={false}>
              Download evidence (JSON)
            </Link>
          </>
        ) : (
          <p className="text-sm text-neutral-600">There is no signed evidence to show yet.</p>
        )}
      </div>
    </details>
  );
}
