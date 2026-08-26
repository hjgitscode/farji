"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClaimCard } from "@/components/credential/ClaimCard";
import { AddClaimForm } from "@/app/candidate/AddClaimForm";
import { ClaimActions } from "@/app/candidate/ClaimActions";
import type { Candidate, Credential } from "@/lib/mock-data/types";

interface CandidateDashboardClientProps {
  candidate: Candidate;
  initialCredentials: Credential[];
}

export function CandidateDashboardClient({ candidate, initialCredentials }: CandidateDashboardClientProps) {
  const [credentials, setCredentials] = useState(initialCredentials);
  const [showAddForm, setShowAddForm] = useState(false);

  function handleAdd(claim: Credential) {
    setCredentials((prev) => [claim, ...prev]);
    setShowAddForm(false);
  }

  function handleRequestVerification(credentialId: string) {
    setCredentials((prev) =>
      prev.map((c) => (c.credentialId === credentialId ? { ...c, state: "PENDING" } : c)),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Signed in as</p>
        <Button onClick={() => setShowAddForm((v) => !v)}>{showAddForm ? "Close" : "Add Claim"}</Button>
      </div>
      <p className="-mt-2 text-xl font-semibold text-slate-900">{candidate.name}</p>

      {showAddForm && (
        <AddClaimForm
          candidateId={candidate.candidateId}
          nextId={`CRED-NEW-${credentials.length + 1}`}
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {credentials.map((credential) => (
          <ClaimCard
            key={credential.credentialId}
            credential={credential}
            actions={
              <ClaimActions
                credential={credential}
                onRequestVerification={() => handleRequestVerification(credential.credentialId)}
              />
            }
          />
        ))}
      </div>
    </div>
  );
}
