import Link from "next/link";
import { btn, Disclosure, Facts, Icon, Mono } from "@/components/ui";
import { explorerTxUrl, formatDateTime, NETWORK_NAME } from "@/lib/format";
import type { ProofBundle } from "@/lib/verification/bundle";
import { groupChecks } from "@/lib/verification/evidence-groups";
import type { VerificationResult } from "@/lib/verification/types";

const when = (iso: string | null | undefined) => (iso ? formatDateTime(new Date(iso)) : "");

/**
 * "View verification details": the technical evidence, collapsed by default. Everything shown is public by design (no salts,
 * no signing nonce, no private content). Checks are grouped by what they prove; identifiers follow.
 */
export function EvidenceDetails({ bundle, result, credentialRef }: { bundle: ProofBundle | null; result: VerificationResult; credentialRef: string }) {
  const groups = groupChecks(result.checks);
  const txHash = bundle?.anchorEvidence?.transactionHash ? String(bundle.anchorEvidence.transactionHash) : "";
  const explorer = bundle && txHash ? explorerTxUrl(bundle.network.chainId, txHash) : null;
  return (
    <Disclosure summary="View verification details">
      <div className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-neutral-900">What was checked</h3>
          {groups.map((g) => (
            <section key={g.id} className="space-y-1.5">
              <h4 className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                <Icon name={g.icon} className="size-4 text-neutral-500" />
                {g.title}
              </h4>
              <ul className="space-y-1 pl-6 text-sm text-neutral-700">
                {g.checks.map((c, i) => (
                  <li key={`${c.id}-${i}`} className="flex gap-2">
                    <span aria-hidden="true" className={c.status === "PASS" ? "text-emerald-700" : c.status === "FAIL" ? "text-rose-700" : "text-neutral-400"}>
                      {c.status === "PASS" ? "✓" : c.status === "FAIL" ? "×" : "…"}
                    </span>
                    <span>
                      <span className="sr-only">{c.status === "PASS" ? "Passed: " : c.status === "FAIL" ? "Failed: " : c.status === "NOT_APPLICABLE" ? "Not applicable: " : "Waiting: "}</span>
                      {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {bundle ? (
          <>
            <div className="space-y-3 border-t border-neutral-100 pt-5">
              <h3 className="text-sm font-semibold text-neutral-900">Blockchain proof</h3>
              <Facts
                items={[
                  ["Network", NETWORK_NAME[bundle.network.chainId] ?? `Chain ${bundle.network.chainId}`],
                  ["Anchor status", bundle.anchorEvidence ? (bundle.anchorEvidence.transactionStatus === "FINALIZED" ? "Finalized" : String(bundle.anchorEvidence.transactionStatus ?? "")) : ""],
                  ["Evidence type", bundle.anchorEvidence ? (bundle.anchorEvidence.attestationType === "COHORT" ? "Credential batch" : "Current-relationship record") : ""],
                  ["Anchored on", when(bundle.anchorEvidence?.anchoredAt as string | null | undefined)],
                  ["Anchor sequence", bundle.anchorEvidence ? String(bundle.anchorEvidence.epoch) : ""],
                  ["Transaction", txHash ? <Mono key="t">{txHash}</Mono> : ""],
                  ["Block", bundle.anchorEvidence?.blockNumber ? String(bundle.anchorEvidence.blockNumber) : ""],
                  ["Registry contract", <Mono key="r">{bundle.network.registryContract}</Mono>],
                ]}
              />
              {explorer ? (
                <a href={explorer} target="_blank" rel="noopener noreferrer" className={`${btn.link} inline-flex items-center gap-1.5`}>
                  View the transaction on a block explorer
                  <Icon name="external" className="size-3.5" />
                </a>
              ) : null}
            </div>

            <div className="space-y-3 border-t border-neutral-100 pt-5">
              <h3 className="text-sm font-semibold text-neutral-900">Credential and issuer</h3>
              <Facts
                items={[
                  ["Credential identifier", <Mono key="id">{bundle.credential.credentialId}</Mono>],
                  ["Issuing organisation", bundle.organisation.name],
                  ["Record type", bundle.lifecycle.toLowerCase()],
                  ["Signed on", when(bundle.credential.issuedAt)],
                  ["Issuer wallet", <Mono key="w">{bundle.safeAttestationEvidence.signerWallet}</Mono>],
                ]}
              />
            </div>

            <p className="text-xs leading-relaxed text-neutral-500">Private content and secrets are never published. This evidence lets anyone check the signer, the inclusion proof and the anchor record without them.</p>
            <Link href={`/verify/${credentialRef}/bundle`} className={btn.secondary} prefetch={false}>
              <Icon name="file" className="size-4" />
              Download evidence (JSON)
            </Link>
          </>
        ) : (
          <p className="text-sm text-neutral-600">There is no signed evidence to show yet.</p>
        )}
      </div>
    </Disclosure>
  );
}
