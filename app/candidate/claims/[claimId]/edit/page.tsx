import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updateClaimAction } from "@/app/candidate/actions";
import { ClaimForm } from "@/components/candidate/ClaimForm";
import { PageHeader } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/guards";
import { readContent } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { getCandidateClaim } from "@/server/candidate/claims";
import { DomainError } from "@/server/candidate/errors";

export const metadata: Metadata = { title: "Edit record" };

export default async function EditClaimPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  const actor = await requireCandidate("/candidate/claims");

  let claim;
  try {
    claim = await getCandidateClaim(getDb(), actor, claimId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  if (claim.archivedAt || !claim.latestVersion) notFound();

  const initial = { ...readContent(claim.latestVersion.content), lifecycleType: claim.latestVersion.proposedLifecycleType };

  return (
    <div>
      <PageHeader
        title="Edit record"
        description={`Saving creates a new version (version ${claim.latestVersion.versionNumber + 1}). Earlier versions are kept, and any open verification request for the previous version is closed as superseded. The new version is not verified until an organisation verifies it.`}
      />
      <ClaimForm action={updateClaimAction.bind(null, claim.id)} submitLabel="Save as new version" initial={initial} fixedCategory={claim.category} />
    </div>
  );
}
