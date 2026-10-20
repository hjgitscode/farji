import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveRequestAction, rejectRequestAction } from "@/app/issuer/actions";
import { ApproveForm, RejectForm } from "@/components/issuer/ReviewForms";
import { Alert, btn, Card, Facts, PageHeader, Section } from "@/components/ui";
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
    <div className="space-y-8">
      <p>
        <Link href="/issuer/requests" className={btn.link}>
          ← All requests
        </Link>
      </p>
      <PageHeader title={c.title ?? "Request"} description={`${c.organisationName ?? ""} · ${CATEGORY_LABEL[v.category] ?? v.category} · ${LIFECYCLE_LABEL[v.proposedLifecycleType] ?? ""} · version ${v.versionNumber}`} />

      <Card className="space-y-3">
        <h2 className="font-semibold">What the candidate submitted</h2>
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
            ["Status", REQUEST_STATUS_LABEL[request.status] ?? request.status],
            ["Candidate identifier", request.institutionalIdentifier],
            ["Candidate note", request.candidateNote],
          ]}
        />
      </Card>

      {request.decision ? (
        <Section title="Decision">
          <p className="text-sm">
            {request.decision.decision === "APPROVE" ? "Approved" : "Rejected"} on {formatDate(request.decision.decidedAt)}
            {request.decision.rejectionReason ? ` (${request.decision.rejectionReason.toLowerCase().replaceAll("_", " ")})` : ""}
          </p>
          <Facts items={[["Reference", request.decision.sourceOfTruthReference], ["Internal notes", request.decision.notes]]} />
          {v.credential ? <p className="text-sm text-neutral-700">Approved. The next step is signing, under Credentials.</p> : null}
        </Section>
      ) : null}

      {reviewable ? (
        <Section title="Your decision">
          <Alert tone="info" title="Confirm from your own records">
            By approving, your organisation attests that this record matches your own records. The approval is then signed with your organisation&apos;s wallet. Rejecting keeps the request on file and tells the candidate which part did not match; the record remains theirs, as self-declared.
          </Alert>
          <div className="grid gap-6 lg:grid-cols-2">
            <ApproveForm action={approveRequestAction.bind(null, request.id)} />
            <RejectForm action={rejectRequestAction.bind(null, request.id)} />
          </div>
        </Section>
      ) : OPEN.includes(request.status) ? (
        <Alert tone="warning">{request.isOwnClaim ? "You cannot review your own record." : "This request is for a version that has since been replaced and can no longer be reviewed."}</Alert>
      ) : null}
    </div>
  );
}
