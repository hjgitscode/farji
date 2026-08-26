"use client";

import { useState } from "react";
import { Wallet } from "ethers";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getOrganisationById } from "@/lib/services/organisationService";
import { getActiveIssuerWallet } from "@/lib/services/issuerService";
import { canonicaliseCredential } from "@/lib/crypto/canonicalise";
import { hashCredential } from "@/lib/crypto/hash";
import { toCanonicalInput } from "@/lib/crypto/fromMockCredential";
import {
  buildCredentialAttestationMessage,
  buildDomain,
  recoverCredentialAttestationSigner,
  signCredentialAttestation,
} from "@/lib/crypto/eip712";
import { findDemoWalletByAddress } from "@/lib/crypto/demoWallets";
import type { Credential } from "@/lib/mock-data/types";

function truncateHex(hex: string) {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

interface SignedAttestation {
  signature: string;
  recoveredSigner: string;
  issuerWallet: string;
}

// The real Phase 3 canonicalisation — a deterministic, fixed-field-order
// view of the claim. This exact object is what Phase 4 feeds into
// Keccak-256; the hash below is still a placeholder until then.
function canonicalPreview(credential: Credential) {
  return JSON.stringify(canonicaliseCredential(toCanonicalInput(credential)), null, 2);
}

export function PendingRequestsPanel({ initialPending }: { initialPending: Credential[] }) {
  const [pending, setPending] = useState(initialPending);
  const [decided, setDecided] = useState<Record<string, "APPROVED" | "REJECTED">>({});
  const [signed, setSigned] = useState<Record<string, SignedAttestation>>({});

  function decide(credentialId: string, decision: "APPROVED" | "REJECTED") {
    setPending((prev) => prev.filter((c) => c.credentialId !== credentialId));
    setDecided((prev) => ({ ...prev, [credentialId]: decision }));
  }

  async function handleSign(credential: Credential) {
    const activeRecord = getActiveIssuerWallet(credential.organisationId);
    const demoWallet = activeRecord && findDemoWalletByAddress(activeRecord.wallet);
    if (!activeRecord || !demoWallet) return;

    const issuer = new Wallet(demoWallet.privateKey);
    const domain = buildDomain();
    const message = buildCredentialAttestationMessage({
      credentialId: credential.credentialId,
      claimHash: hashCredential(toCanonicalInput(credential)),
      organisationId: credential.organisationId,
      version: credential.version,
      nonce: Date.now(),
      timestamp: Math.floor(Date.now() / 1000),
    });

    const signature = await signCredentialAttestation(issuer, message, domain);
    const recoveredSigner = recoverCredentialAttestationSigner(message, signature, domain);

    setSigned((prev) => ({
      ...prev,
      [credential.credentialId]: { signature, recoveredSigner, issuerWallet: activeRecord.wallet },
    }));
  }

  if (pending.length === 0 && Object.keys(decided).length === 0) {
    return <p className="text-sm text-slate-500">No pending verification requests.</p>;
  }

  return (
    <div className="space-y-3">
      {pending.map((credential) => {
        const organisation = getOrganisationById(credential.organisationId);
        return (
          <Card key={credential.credentialId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-slate-900">{credential.title}</p>
                <p className="text-sm text-slate-500">
                  {credential.candidateId} · {organisation?.name ?? credential.organisationId} ·{" "}
                  {credential.lifecycleType}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => decide(credential.credentialId, "APPROVED")}>
                  Approve
                </Button>
                <Button variant="danger" onClick={() => decide(credential.credentialId, "REJECTED")}>
                  Reject
                </Button>
              </div>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-brand">
                Canonical credential + hash
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                {canonicalPreview(credential)}
              </pre>
              <p className="mt-2 font-mono text-xs text-slate-500">
                Keccak-256: {truncateHex(hashCredential(toCanonicalInput(credential)))}
              </p>

              {signed[credential.credentialId] ? (
                <div className="mt-3 space-y-1 rounded-md bg-slate-50 p-3 text-xs">
                  <p className="font-mono text-slate-500">
                    Signature: {truncateHex(signed[credential.credentialId].signature)}
                  </p>
                  <p className="font-mono text-slate-500">
                    Recovered signer: {truncateHex(signed[credential.credentialId].recoveredSigner)}
                  </p>
                  <Badge
                    tone={
                      signed[credential.credentialId].recoveredSigner.toLowerCase() ===
                      signed[credential.credentialId].issuerWallet.toLowerCase()
                        ? "green"
                        : "red"
                    }
                  >
                    {signed[credential.credentialId].recoveredSigner.toLowerCase() ===
                    signed[credential.credentialId].issuerWallet.toLowerCase()
                      ? "Recovered signer matches issuer wallet"
                      : "Signer mismatch"}
                  </Badge>
                </div>
              ) : (
                <Button className="mt-3" variant="secondary" onClick={() => handleSign(credential)}>
                  Sign (EIP-712)
                </Button>
              )}
            </details>
          </Card>
        );
      })}

      {Object.entries(decided).map(([credentialId, decision]) => (
        <p key={credentialId} className="text-sm text-slate-500">
          {credentialId}: <span className="font-medium">{decision}</span>
        </p>
      ))}
    </div>
  );
}
