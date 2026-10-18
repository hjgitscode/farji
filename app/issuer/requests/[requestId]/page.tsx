import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveRequestAction, rejectRequestAction } from "@/app/issuer/actions";
import { ApproveForm, RejectForm } from "@/components/issuer/ReviewForms";
import { requireIssuer } from "@/lib/auth/guards";
import { readContent, REQUEST_STATUS_LABEL } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { DomainError } from "@/server/candidate/errors";
import { getIssuerRequest } from "@/server/issuer/review";

export const metadata: Metadata = { title: "Review request" };

const OPEN = ["SUBMITTED", "IN_REVIEW"];

export default async function IssuerRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const actor = await requireIssuer("/issuer/requests");

  let request;
  try {
    request = await getIssuerRequest(getDb(), actor, requestId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const v = request.claimVersion;
  const c = readContent(v.content);
  const reviewable = OPEN.includes(request.status) && v.isCurrentVersion && !request.isOwnClaim;

  return (
    <section className="space-y-6">
      <p>
        <Link href="/issuer/requests" className="text-sm underline">
          ← All requests
        </Link>
      </p>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-neutral-700">
          {c.organisationName} · {v.category.toLowerCase()} · {v.proposedLifecycleType.toLowerCase()} · version {v.versionNumber}
        </p>
        <p className="text-sm text-neutral-600">
          {c.startDate}
          {c.endDate ? ` → ${c.endDate}` : ""}
          {c.expiryDate ? ` · expires ${c.expiryDate}` : ""}
        </p>
        {c.description ? <p className="text-sm">{c.description}</p> : null}
        {c.fieldOfStudy ? <p className="text-sm">Field of study: {c.fieldOfStudy}</p> : null}
        {c.credentialNumber ? <p className="text-sm">Credential number: {c.credentialNumber}</p> : null}
        {c.location ? <p className="text-sm">Location: {c.location}</p> : null}
        <p className="text-sm text-neutral-600">
          Submitted {request.submittedAt.toISOString().slice(0, 10)} · Status: {REQUEST_STATUS_LABEL[request.status] ?? request.status}
        </p>
        {request.institutionalIdentifier ? <p className="text-sm">Candidate identifier: {request.institutionalIdentifier}</p> : null}
        {request.candidateNote ? <p className="text-sm">Candidate note: {request.candidateNote}</p> : null}
      </div>

      {request.decision ? (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Decision</h2>
          <p className="text-sm">
            {request.decision.decision === "APPROVE" ? "Approved" : "Rejected"} on {request.decision.decidedAt.toISOString().slice(0, 10)}
            {request.decision.rejectionReason ? ` (${request.decision.rejectionReason.toLowerCase().replaceAll("_", " ")})` : ""}
          </p>
          {request.decision.sourceOfTruthReference ? <p className="text-sm">Reference: {request.decision.sourceOfTruthReference}</p> : null}
          {request.decision.notes ? <p className="text-sm">Notes: {request.decision.notes}</p> : null}
          {v.credential ? (
            <p className="text-sm text-neutral-700">
              Credential prepared ({v.credential.lifecycleType.toLowerCase()}); signing is the next step and has not happened yet.
            </p>
          ) : null}
        </div>
      ) : null}

      {reviewable ? (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Review</h2>
          <ApproveForm action={approveRequestAction.bind(null, request.id)} />
          <RejectForm action={rejectRequestAction.bind(null, request.id)} />
        </div>
      ) : OPEN.includes(request.status) ? (
        <p className="text-sm text-neutral-700">
          {request.isOwnClaim ? "You cannot review your own claim." : "This request is for a version that has been replaced and can no longer be reviewed."}
        </p>
      ) : null}
    </section>
  );
}
