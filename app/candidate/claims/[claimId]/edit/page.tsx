import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updateClaimAction } from "@/app/candidate/actions";
import { ClaimForm } from "@/components/candidate/ClaimForm";
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
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit record</h1>
      <p className="max-w-xl text-sm text-neutral-700">
        Saving creates a new version (version {claim.latestVersion.versionNumber + 1}). Earlier versions are kept, and any open
        verification request for the previous version is closed as superseded.
      </p>
      <ClaimForm
        action={updateClaimAction.bind(null, claim.id)}
        submitLabel="Save as new version"
        initial={initial}
        fixedCategory={claim.category}
      />
    </section>
  );
}
