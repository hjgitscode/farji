import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setVisibilityAction, submitRequestAction, withdrawRequestAction } from "@/app/candidate/actions";
import { SubmitRequestForm } from "@/components/candidate/SubmitRequestForm";
import { VerificationStatus } from "@/components/candidate/VerificationStatus";
import { Alert, Badge, btn, Card, inputClass, PageHeader, Section } from "@/components/ui";
import { CopyLink } from "@/components/ui/CopyLink";
import { QrCode } from "@/components/ui/QrCode";
import { requireCandidate } from "@/lib/auth/guards";
import { REQUEST_STATUS_LABEL } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { CATEGORY_LABEL, formatDate, formatPeriod, LIFECYCLE_LABEL } from "@/lib/format";
import { presentState } from "@/lib/verification/present";
import { StatusBadge } from "@/components/ui";
import { getCandidateClaim, listRequestableOrganisations } from "@/server/candidate/claims";
import { DomainError } from "@/server/candidate/errors";
import { getOwnProfile } from "@/server/candidate/profile";
import { publicOrigin, verifierPath } from "@/server/public/origin";
import { deriveCandidateRecords } from "@/server/verification/records";

export const metadata: Metadata = { title: "Record" };

const OPEN = ["SUBMITTED", "IN_REVIEW"];
const VISIBILITY_HELP = {
  PRIVATE: "Only you can see this record.",
  UNLISTED: "Anyone with the verification link can see it. It is not listed on your profile.",
  PUBLIC: "It appears on your public profile (when your profile is shared) and anyone with the link can verify it.",
} as const;

export default async function ClaimDetailPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  const actor = await requireCandidate("/candidate/claims");
  const db = getDb();

  let claim;
  try {
    claim = await getCandidateClaim(db, actor, claimId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const latest = claim.latestVersion;
  if (!latest) notFound();

  const [{ available, records }, profile] = await Promise.all([deriveCandidateRecords(db, actor, [claim.id]), getOwnProfile(db, actor)]);
  const record = records[0];
  const result = record?.result ?? null;
  const c = record?.current.content ?? {};
  const lifecycle = result?.lifecycleType ?? latest.proposedLifecycleType;
  const canRequest = !claim.archivedAt && !latest.verificationRequests.some((r) => OPEN.includes(r.status) || r.status === "APPROVED") && result?.state === "SELF_DECLARED";
  const organisations = canRequest ? await listRequestableOrganisations(db, actor) : [];

  const origin = await publicOrigin();
  const shareable = record && record.visibility !== "PRIVATE" && record.credentialRef && result && !["SELF_DECLARED", "PENDING"].includes(result.state);
  const verifierUrl = shareable ? `${origin}${verifierPath(record!.credentialRef!)}` : null;

  return (
    <div className="space-y-8">
      <p>
        <Link href="/candidate/claims" className={btn.link}>
          ← My records
        </Link>
      </p>
      <PageHeader
        title={c.title ?? "Record"}
        description={`${c.organisationName ?? ""} · ${CATEGORY_LABEL[claim.category] ?? claim.category} · ${LIFECYCLE_LABEL[lifecycle] ?? ""}`}
        actions={
          !claim.archivedAt ? (
            <Link href={`/candidate/claims/${claim.id}/edit`} className={btn.secondary}>
              Edit (creates a new version)
            </Link>
          ) : null
        }
      />

      <Card className="space-y-3">
        <p className="text-sm text-neutral-600">{formatPeriod(c.startDate, c.endDate, lifecycle === "CONTINUING" && result?.state !== "ENDED")}{c.expiryDate ? ` · expires ${formatDate(c.expiryDate)}` : ""}</p>
        {c.description ? <p className="text-sm">{c.description}</p> : null}
        {c.location ? <p className="text-sm text-neutral-600">{c.location}</p> : null}
        <VerificationStatus result={result} available={available} detail />
        {record?.earlierVerified ? (
          <Alert tone="info">
            An earlier version of this record (version {record.earlierVerified.versionNumber}) was verified{record.earlierVerified.organisationName ? ` by ${record.earlierVerified.organisationName}` : ""}. This version is not verified yet, and is not shown as verified.
          </Alert>
        ) : null}
      </Card>

      <Section title="Verification" description="Ask the organisation that holds the record to confirm it from its own files.">
        {canRequest ? (
          <SubmitRequestForm action={submitRequestAction.bind(null, claim.id)} claimVersionId={latest.id} organisations={organisations} />
        ) : (
          <p className="text-sm text-neutral-700">
            {claim.archivedAt
              ? "This record is archived."
              : result?.state === "SELF_DECLARED"
                ? "No organisation is available to verify this record yet."
                : "This version already has a request or a verification. Edit the record to ask again for a changed version."}
          </p>
        )}
      </Section>

      <Section title="Who can see this record" description={VISIBILITY_HELP[record?.visibility ?? "PRIVATE"]}>
        <form action={setVisibilityAction.bind(null, claim.id)} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="visibility" className="block text-sm font-medium">
              Visibility
            </label>
            <select id="visibility" name="visibility" defaultValue={record?.visibility ?? "PRIVATE"} className={inputClass}>
              <option value="PRIVATE">Private</option>
              <option value="UNLISTED">Shared by link only</option>
              <option value="PUBLIC">On my public profile</option>
            </select>
          </div>
          <button type="submit" className={btn.secondary}>
            Save
          </button>
        </form>
        {record && record.visibility === "PUBLIC" && !profile ? (
          <Alert tone="info">
            Your public profile is not set up, so this record is not listed anywhere yet.{" "}
            <Link href="/candidate/profile" className="font-medium underline">
              Set up profile
            </Link>
          </Alert>
        ) : null}
      </Section>

      {verifierUrl ? (
        <Section title="Share this credential" description="Anyone with this link can check the current status. The QR code contains only the link.">
          <CopyLink url={verifierUrl} />
          <QrCode url={verifierUrl} label="QR code for the credential verification link" />
        </Section>
      ) : record && record.visibility === "PRIVATE" && result && !["SELF_DECLARED", "PENDING"].includes(result.state) ? (
        <p className="text-sm text-neutral-600">Change visibility above to share this verified record.</p>
      ) : null}

      <Section title="Version history" description="Earlier versions are always kept.">
        <ul className="space-y-3">
          {claim.versions.map((version) => {
            const vr = record?.versions.find((x) => x.versionId === version.id);
            const vc = vr?.content ?? {};
            const vp = vr?.credentialResult ? presentState(vr.credentialResult) : null;
            return (
              <Card as="li" key={version.id} className="space-y-2">
                <p className="font-medium">
                  Version {version.versionNumber}
                  {version.id === latest.id ? " (current)" : ""} · {vc.title}
                </p>
                <p className="text-xs text-neutral-500">Saved {formatDate(version.createdAt)}</p>
                {vp ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge presentation={vp} /> {vp.headline}
                  </p>
                ) : (
                  <p className="text-sm text-neutral-600">Not verified</p>
                )}
                {version.verificationRequests.length === 0 ? (
                  <p className="text-sm text-neutral-600">No requests for this version.</p>
                ) : (
                  <ul className="space-y-1">
                    {version.verificationRequests.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          {r.organisation.displayName}: <Badge>{REQUEST_STATUS_LABEL[r.status] ?? r.status}</Badge>
                          {r.decision?.rejectionReason ? ` (${r.decision.rejectionReason.toLowerCase().replaceAll("_", " ")})` : ""}
                        </span>
                        {OPEN.includes(r.status) ? (
                          <form action={withdrawRequestAction.bind(null, r.id)}>
                            <button type="submit" className={btn.link}>
                              Withdraw request
                            </button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
