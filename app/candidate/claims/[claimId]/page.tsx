import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { submitRequestAction, withdrawRequestAction } from "@/app/candidate/actions";
import { SubmitRequestForm } from "@/components/candidate/SubmitRequestForm";
import { requireCandidate } from "@/lib/auth/guards";
import { readContent, REQUEST_STATUS_LABEL } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { getCandidateClaim, listRequestableOrganisations } from "@/server/candidate/claims";
import { DomainError } from "@/server/candidate/errors";
import { VerificationStatus } from "@/components/candidate/VerificationStatus";
import { deriveCandidateClaimStates } from "@/server/verification/service";

export const metadata: Metadata = { title: "Record details" };

const OPEN = ["SUBMITTED", "IN_REVIEW"];

export default async function ClaimDetailPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  const actor = await requireCandidate("/candidate/claims");

  let claim;
  try {
    claim = await getCandidateClaim(getDb(), actor, claimId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const latest = claim.latestVersion;
  if (!latest) notFound();

  const content = readContent(latest.content);
  const canRequest =
    !claim.archivedAt && !latest.verificationRequests.some((r) => OPEN.includes(r.status) || r.status === "APPROVED");
  const organisations = canRequest ? await listRequestableOrganisations(getDb(), actor) : [];
  const { available, states } = await deriveCandidateClaimStates(getDb(), actor, [claim.id]);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{content.title}</h1>
        <p className="text-neutral-700">
          {content.organisationName} · {claim.category.toLowerCase()} · {latest.proposedLifecycleType.toLowerCase()} · version{" "}
          {latest.versionNumber}
        </p>
        <p className="text-sm text-neutral-600">
          {content.startDate}
          {content.endDate ? ` → ${content.endDate}` : ""}
          {content.expiryDate ? ` · expires ${content.expiryDate}` : ""}
        </p>
        {content.description ? <p className="text-sm">{content.description}</p> : null}
        {!claim.archivedAt ? (
          <p>
            <Link href={`/candidate/claims/${claim.id}/edit`} className="text-sm underline">
              Edit (creates a new version)
            </Link>
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Verification status</h2>
        <VerificationStatus result={states.get(claim.id)} available={available} detail />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Verification request</h2>
        {canRequest ? (
          <SubmitRequestForm
            action={submitRequestAction.bind(null, claim.id)}
            claimVersionId={latest.id}
            organisations={organisations}
          />
        ) : (
          <p className="text-sm text-neutral-700">
            {claim.archivedAt ? "This record is archived." : "This version already has an open or approved request."}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">History</h2>
        <ul className="space-y-4">
          {claim.versions.map((version) => {
            const c = readContent(version.content);
            return (
              <li key={version.id} className="rounded border border-neutral-200 p-3">
                <p className="font-medium">
                  Version {version.versionNumber}
                  {version.id === latest.id ? " (current)" : ""} · {c.title}
                </p>
                <p className="text-xs text-neutral-600">Saved {version.createdAt.toISOString().slice(0, 10)}</p>
                {version.verificationRequests.length === 0 ? (
                  <p className="mt-1 text-sm text-neutral-600">No requests for this version.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {version.verificationRequests.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          {r.organisation.displayName}: {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                          {r.decision?.rejectionReason
                            ? ` (${r.decision.rejectionReason.toLowerCase().replaceAll("_", " ")})`
                            : ""}
                        </span>
                        {OPEN.includes(r.status) ? (
                          <form action={withdrawRequestAction.bind(null, r.id)}>
                            <button type="submit" className="underline">
                              Withdraw
                            </button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
