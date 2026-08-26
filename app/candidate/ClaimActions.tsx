"use client";

import { Button } from "@/components/ui/Button";
import { EpochTimeline } from "@/components/proof-timeline/EpochTimeline";
import { buildVerificationResult } from "@/lib/services/verificationService";
import { getAttestations } from "@/lib/services/attestationService";
import type { Credential } from "@/lib/mock-data/types";

function truncateHex(hex: string) {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard access can be denied by the browser — copying is a
    // convenience here, not required for the demo to work.
  }
}

interface ClaimActionsProps {
  credential: Credential;
  onRequestVerification: () => void;
}

export function ClaimActions({ credential, onRequestVerification }: ClaimActionsProps) {
  if (credential.state === "SELF_DECLARED") {
    return (
      <Button variant="secondary" onClick={onRequestVerification}>
        Request Verification
      </Button>
    );
  }

  if (credential.state === "PENDING") {
    return <p className="text-sm text-slate-500">Awaiting issuer approval.</p>;
  }

  const result = buildVerificationResult(credential.credentialId);
  const verifyPath = `/verify/${credential.credentialId}`;
  const relatedEpochs = credential.cohortEpochId
    ? getAttestations(credential.organisationId, "COHORT")
    : credential.proofPulseStreamId
      ? getAttestations(credential.organisationId, "PROOF_PULSE")
      : [];

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand">View Proof</summary>
          {result?.technicalProof && (
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
              <dt>Claim hash</dt>
              <dd className="font-mono">{truncateHex(result.technicalProof.claimHash)}</dd>
              <dt>Issuer wallet</dt>
              <dd className="font-mono">{truncateHex(result.technicalProof.issuerWallet)}</dd>
              <dt>Signature</dt>
              <dd className="font-mono">{truncateHex(result.technicalProof.signature)}</dd>
              {result.technicalProof.merkleRoot && (
                <>
                  <dt>Merkle root</dt>
                  <dd className="font-mono">{truncateHex(result.technicalProof.merkleRoot)}</dd>
                </>
              )}
            </dl>
          )}
        </details>

        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand">
            Generate Verification Link
          </summary>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-slate-100 px-2 py-1 text-xs">{verifyPath}</code>
            <Button variant="ghost" onClick={() => copyToClipboard(verifyPath)}>
              Copy
            </Button>
          </div>
        </details>

        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand">Generate QR</summary>
          <div className="mt-2 flex h-24 w-24 flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 bg-slate-50 text-center text-[10px] text-slate-400">
            <span className="font-semibold text-slate-500">QR</span>
            <span className="px-1">visual placeholder</span>
          </div>
        </details>

        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand">View History</summary>
          <div className="mt-2">
            {relatedEpochs.length > 0 ? (
              <EpochTimeline epochs={relatedEpochs} />
            ) : (
              <p className="text-xs text-slate-500">
                Created {credential.startDate}, version {credential.version}. No batch attestation is
                linked to this claim.
              </p>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
