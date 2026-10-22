import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveRequestAction, rejectRequestAction } from "@/app/issuer/actions";
import { ApproveForm, RejectForm } from "@/components/issuer/ReviewForms";
import { Alert, Badge, Facts, Icon, PageHeader, Panel } from "@/components/ui";
import { CATEGORY_LABEL, formatDate, LIFECYCLE_LABEL } from "@/lib/format";
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
    <div className="space-y-6">
      <Link href="/issuer/requests" className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900">
        <Icon name="chevron-right" className="size-4 rotate-180" />
        All requests
      </Link>
      <PageHeader
        title={c.title ?? "Request"}
        description={`${c.organisationName ?? ""} · ${CATEGORY_LABEL[v.category] ?? v.category} · ${LIFECYCLE_LABEL[v.proposedLifecycleType] ?? ""} · version ${v.versionNumber}`}
        actions={<Badge tone={OPEN.includes(request.status) ? "pending" : "neutral"}>{REQUEST_STATUS_LABEL[request.status] ?? request.status}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel title="What the candidate submitted" description="Compare each line with your organisation's own records.">
          <Facts
            items={[
              ["Started", formatDate(c.startDate)],
              ["Ended", formatDate(c.endDate)],
              ["Expires", formatDate(c.expiryDate)],
              ["Location", c.location],
              ["Field of study", c.fieldOfStudy],
              ["Credential number", c.credentialNumber],
              ["Description", c.description],
              ["Submitted", formatDate(request.submittedAt)],
              ["Candidate identifier", request.institutionalIdentifier],
              ["Candidate note", request.candidateNote],
            ]}
          />
        </Panel>

        <div className="space-y-4">
          {request.decision ? (
            <Panel title="Decision">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Badge tone={request.decision.decision === "APPROVE" ? "verified" : "neutral"} icon={request.decision.decision === "APPROVE" ? "check" : "x"}>
                  {request.decision.decision === "APPROVE" ? "Approved" : "Rejected"}
                </Badge>
                <span className="text-neutral-600">
                  on {formatDate(request.decision.decidedAt)}
                  {request.decision.rejectionReason ? ` (${request.decision.rejectionReason.toLowerCase().replaceAll("_", " ")})` : ""}
                </span>
              </p>
              <div className="mt-4">
                <Facts items={[["Reference", request.decision.sourceOfTruthReference], ["Internal notes", request.decision.notes]]} />
              </div>
              {v.credential ? <p className="mt-4 text-sm text-neutral-700">Approved. The next step is signing, under Credentials.</p> : null}
            </Panel>
          ) : null}

          {reviewable ? (
            <Alert tone="info" title="Confirm from your own records">
              By approving, your organisation attests that this record matches your own records. The approval is then signed with your organisation&apos;s wallet.
            </Alert>
          ) : OPEN.includes(request.status) ? (
            <Alert tone="warning">{request.isOwnClaim ? "You cannot review your own record." : "This request is for a version that has since been replaced and can no longer be reviewed."}</Alert>
          ) : null}
        </div>
      </div>

      {reviewable ? (
        <section aria-label="Your decision" className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight">Your decision</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <ApproveForm action={approveRequestAction.bind(null, request.id)} />
            <RejectForm action={rejectRequestAction.bind(null, request.id)} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
