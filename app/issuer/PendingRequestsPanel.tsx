"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getOrganisationById } from "@/lib/services/organisationService";
import { placeholderHex } from "@/lib/mock-data/mockHex";
import { canonicaliseCredential } from "@/lib/crypto/canonicalise";
import { toCanonicalInput } from "@/lib/crypto/fromMockCredential";
import type { Credential } from "@/lib/mock-data/types";

function truncateHex(hex: string) {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
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

  function decide(credentialId: string, decision: "APPROVED" | "REJECTED") {
    setPending((prev) => prev.filter((c) => c.credentialId !== credentialId));
    setDecided((prev) => ({ ...prev, [credentialId]: decision }));
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
                Keccak-256 (placeholder — real hashing arrives in Phase 4):{" "}
                {truncateHex(placeholderHex(credential.credentialId))}
              </p>
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
