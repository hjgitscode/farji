import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceDetails } from "@/components/public/EvidenceDetails";
import { Alert, btn, Card, Facts, StatusBadge } from "@/components/ui";
import { CopyLink } from "@/components/ui/CopyLink";
import { QrCode } from "@/components/ui/QrCode";
import { getDb } from "@/lib/database/client";
import { CATEGORY_LABEL, formatDate, formatDateTime, formatPeriod, LIFECYCLE_LABEL } from "@/lib/format";
import { presentState } from "@/lib/verification/present";
import { publicOrigin, verifierPath } from "@/server/public/origin";
import { getPublicCredential, parseCredentialRef } from "@/server/public/read";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ credentialRef: string }> };

// A verifier page is never indexed: it answers a question about one record for whoever holds the link.
export const metadata: Metadata = { title: "Verify a credential", robots: { index: false, follow: false } };

export default async function VerifyCredentialPage({ params }: Props) {
  const { credentialRef } = await params;
  const ref = parseCredentialRef(credentialRef);
  const view = ref ? await getPublicCredential(getDb(), ref) : null;
  // Malformed, unknown and unpublished all look the same.
  if (!ref || !view) notFound();

  const { record: r, result, holder, bundle, isCurrentVersion } = view;
  const p = presentState(result, "public");
  const url = `${await publicOrigin()}${verifierPath(ref)}`;
  const current = result.lifecycleType === "CONTINUING" && result.state !== "ENDED";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-neutral-600">Credential check</p>
        <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
        <p className="text-neutral-700">
          {r.organisationName} · {CATEGORY_LABEL[r.category] ?? r.category}
          {holder ? ` · ${holder.displayName}` : ""}
        </p>
        <p className="text-sm text-neutral-500">
          {formatPeriod(r.startDate, r.endDate, current)}
          {r.expiryDate ? ` · expires ${formatDate(r.expiryDate)}` : ""}
        </p>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge presentation={p} />
          <h2 className="text-lg font-semibold">{p.headline}</h2>
        </div>
        <p className="text-sm text-neutral-700">{p.explanation}</p>
        <Facts
          items={[
            ["Confirmed by", result.organisation?.displayName ?? ""],
            ["Record type", result.lifecycleType ? LIFECYCLE_LABEL[result.lifecycleType] : ""],
            ["Signed on", formatDateTime(result.evidenceSummary.issuedAt)],
            ["Verified on", formatDateTime(result.evidenceTimestamp)],
            ["Confirmation fresh until", result.state === "CURRENTLY_ATTESTED" ? formatDate(result.freshnessDeadline) : ""],
            ["Valid until", result.state === "VERIFIED" ? formatDate(result.expiry) : ""],
          ]}
        />
      </Card>

      {!isCurrentVersion ? <Alert tone="info">The holder has since created a newer version of this record. This page shows the earlier version.</Alert> : null}
      {result.state === "SELF_DECLARED" || result.state === "PENDING" ? (
        <Alert tone="warning">Nothing here is verified yet. Do not rely on this record until an organisation confirms it.</Alert>
      ) : null}

      <EvidenceDetails bundle={bundle} result={result} credentialRef={ref} />

      <section className="space-y-3" aria-label="Share this check">
        <h2 className="text-lg font-semibold">Share this check</h2>
        <CopyLink url={url} />
        <QrCode url={url} label="QR code for this verification link" />
        {holder?.handle ? (
          <p>
            <Link href={`/p/${holder.handle}`} className={btn.link}>
              View {holder.displayName}&apos;s profile
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
