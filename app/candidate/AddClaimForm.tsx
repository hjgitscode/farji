"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getOrganisations } from "@/lib/services/organisationService";
import type { ClaimType, Credential, LifecycleType } from "@/lib/mock-data/types";

const claimTypes: ClaimType[] = ["DEGREE", "EMPLOYMENT", "INTERNSHIP", "CERTIFICATION", "LICENCE"];
const lifecycleTypes: LifecycleType[] = ["PERMANENT", "CONTINUING", "EXPIRING"];

interface AddClaimFormProps {
  candidateId: string;
  nextId: string;
  onAdd: (claim: Credential) => void;
  onCancel: () => void;
}

export function AddClaimForm({ candidateId, nextId, onAdd, onCancel }: AddClaimFormProps) {
  const organisations = getOrganisations();
  const [title, setTitle] = useState("");
  const [claimType, setClaimType] = useState<ClaimType>("EMPLOYMENT");
  const [organisationId, setOrganisationId] = useState(organisations[0]?.organisationId ?? "");
  const [lifecycleType, setLifecycleType] = useState<LifecycleType>("CONTINUING");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd({
      credentialId: nextId,
      candidateId,
      claimType,
      title: title.trim(),
      organisationId,
      lifecycleType,
      version: 1,
      previousVersionId: null,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: null,
      state: "SELF_DECLARED",
    });
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm font-semibold text-slate-700">Add a new claim (demo only — resets on reload)</p>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Claim title, e.g. Product Manager"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={claimType}
            onChange={(e) => setClaimType(e.target.value as ClaimType)}
          >
            {claimTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={organisationId}
            onChange={(e) => setOrganisationId(e.target.value)}
          >
            {organisations.map((org) => (
              <option key={org.organisationId} value={org.organisationId}>
                {org.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={lifecycleType}
            onChange={(e) => setLifecycleType(e.target.value as LifecycleType)}
          >
            {lifecycleTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="submit">Add claim</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
