import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceDetails } from "@/components/public/EvidenceDetails";
import { Alert, btn, Card, categoryIcon, Facts, Icon, StatusBadge, type IconName } from "@/components/ui";
import { CopyLink } from "@/components/ui/CopyLink";
import { QrCode } from "@/components/ui/QrCode";
import { getDb } from "@/lib/database/client";
import { CATEGORY_LABEL, formatDate, formatDateTime, formatPeriod, LIFECYCLE_LABEL } from "@/lib/format";
import { groupChecks } from "@/lib/verification/evidence-groups";
import { presentState, type Tone } from "@/lib/verification/present";
import { publicOrigin, verifierPath } from "@/server/public/origin";
import { TooManyRequests, VerificationUnavailable } from "@/components/public/Notices";
import { RULES } from "@/lib/security/rate-limit";
import { getPublicCredential, parseCredentialRef } from "@/server/public/read";
import { checkLimit, requestKey } from "@/server/security/limit";
import { isVerificationConfigured } from "@/server/verification/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ credentialRef: string }> };

// A verifier page is never indexed: it answers a question about one record for whoever holds the link.
export const metadata: Metadata = { title: "Verify a credential", robots: { index: false, follow: false } };

// The verdict panel: strong and calm for trust-positive results, unmistakable for revoked/invalid, quiet for the rest.
const VERDICT: Record<Tone, { box: string; sub: string; ring: string; icon: IconName }> = {
  verified: { box: "border-emerald-800 bg-emerald-800 text-white", sub: "text-emerald-50/85", ring: "bg-white/15 text-white", icon: "shield-check" },
  current: { box: "border-teal-800 bg-teal-800 text-white", sub: "text-teal-50/85", ring: "bg-white/15 text-white", icon: "shield-check" },
  danger: { box: "border-rose-900 bg-rose-900 text-white", sub: "text-rose-50/85", ring: "bg-white/15 text-white", icon: "alert" },
  attention: { box: "border-amber-300 bg-amber-50 text-amber-950", sub: "text-amber-900/80", ring: "bg-amber-200/70 text-amber-900", icon: "alert" },
  pending: { box: "border-indigo-200 bg-indigo-50 text-indigo-950", sub: "text-indigo-900/80", ring: "bg-indigo-100 text-indigo-700", icon: "clock" },
  muted: { box: "border-slate-300 bg-slate-100 text-slate-900", sub: "text-slate-700", ring: "bg-slate-200 text-slate-700", icon: "history" },
  neutral: { box: "border-neutral-300 bg-white text-neutral-900", sub: "text-neutral-600", ring: "bg-neutral-100 text-neutral-600", icon: "file" },
};

export default async function VerifyCredentialPage({ params }: Props) {
  const { credentialRef } = await params;
  if (!checkLimit(RULES.publicRead, await requestKey()).allowed) return <TooManyRequests />;
  if (!isVerificationConfigured()) return <VerificationUnavailable />;
  const ref = parseCredentialRef(credentialRef);
  const view = ref ? await getPublicCredential(getDb(), ref) : null;
  // Malformed, unknown and unpublished all look the same.
  if (!ref || !view) notFound();

  const { record: r, result, holder, bundle, isCurrentVersion } = view;
  const p = presentState(result, "public");
  const url = `${await publicOrigin()}${verifierPath(ref)}`;
  const current = result.lifecycleType === "CONTINUING" && result.state !== "ENDED";
  const v = VERDICT[p.tone];
  const positive = p.tone === "verified" || p.tone === "current";
  const groups = groupChecks(result.checks);
  const evidenceGroups = result.state === "SELF_DECLARED" ? [] : groups;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/verify" className="hover:text-neutral-900">
          Verify a credential
        </Link>
        <Icon name="chevron-right" className="size-3.5" />
        <span className="text-neutral-700">Credential check</span>
      </p>

      <section aria-labelledby="verdict" className={`overflow-hidden rounded-xl border p-6 sm:p-7 ${v.box}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <span className={`flex size-14 shrink-0 items-center justify-center rounded-xl ${v.ring}`}>
            <Icon name={v.icon} className="size-7" strokeWidth={1.6} />
          </span>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {positive ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-inset ring-white/25">
                  <Icon name="check" className="size-3.5" strokeWidth={2.5} />
                  {p.badge}
                </span>
              ) : (
                <StatusBadge presentation={p} size="lg" />
              )}
              {result.organisation?.displayName ? <span className={`text-sm ${v.sub}`}>Confirmed by {result.organisation.displayName}</span> : null}
            </div>
            <h1 id="verdict" className="text-2xl font-semibold leading-tight tracking-tight sm:text-[1.75rem]">
              {p.headline}
            </h1>
            <p className={`max-w-xl text-sm leading-relaxed ${v.sub}`}>{p.explanation}</p>
          </div>
        </div>

        {positive && evidenceGroups.length > 0 ? (
          <ul className="mt-6 flex flex-wrap gap-2 border-t border-white/15 pt-5" aria-label="Evidence summary">
            {evidenceGroups
              .filter((g) => ["signature", "authority", "inclusion", "anchor"].includes(g.id))
              .map((g) => (
                <li key={g.id} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/20">
                  <Icon name={g.status === "PASS" ? "check" : "clock"} className="size-3.5" strokeWidth={2.5} />
                  {g.title}
                </li>
              ))}
          </ul>
        ) : null}
      </section>

      {!isCurrentVersion ? <Alert tone="info">The holder has since created a newer version of this record. This page shows the earlier version.</Alert> : null}
      {result.state === "SELF_DECLARED" || result.state === "PENDING" ? (
        <Alert tone="warning">Nothing here is verified yet. Do not rely on this record until an organisation confirms it.</Alert>
      ) : null}

      <Card className="space-y-5">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
            <Icon name={categoryIcon(r.category)} className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-snug">{r.title}</h2>
            <p className="text-sm text-neutral-600">
              {r.organisationName} · {CATEGORY_LABEL[r.category] ?? r.category}
              {holder ? ` · ${holder.displayName}` : ""}
            </p>
          </div>
        </div>
        <Facts
          items={[
            ["Held by", holder?.displayName ?? ""],
            ["Confirmed by", result.organisation?.displayName ?? ""],
            ["Period", formatPeriod(r.startDate, r.endDate, current) + (r.expiryDate ? ` · expires ${formatDate(r.expiryDate)}` : "")],
            ["Record type", result.lifecycleType ? LIFECYCLE_LABEL[result.lifecycleType] : ""],
            ["Signed on", formatDateTime(result.evidenceSummary.issuedAt)],
            ["Verified on", formatDateTime(result.evidenceTimestamp)],
            ["Confirmation fresh until", result.state === "CURRENTLY_ATTESTED" ? formatDate(result.freshnessDeadline) : ""],
            ["Valid until", result.state === "VERIFIED" ? formatDate(result.expiry) : ""],
          ]}
        />
      </Card>

      {evidenceGroups.length > 0 ? (
        <section aria-labelledby="trust" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 id="trust" className="text-base font-semibold tracking-tight">
              Trust evidence
            </h2>
            <p className="text-xs text-neutral-500">
              {result.checks.filter((c) => c.status === "PASS").length} of {result.checks.filter((c) => c.status !== "NOT_APPLICABLE").length} checks passed
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {evidenceGroups.map((g) => (
              <li key={g.id} className="flex gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-card">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${g.status === "PASS" ? "bg-emerald-100 text-emerald-700" : g.status === "FAIL" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}
                >
                  <Icon name={g.status === "PASS" ? "check" : g.status === "FAIL" ? "x" : "clock"} className="size-4" strokeWidth={2.5} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {g.title}
                    <span className="sr-only">{g.status === "PASS" ? " — passed" : g.status === "FAIL" ? " — failed" : " — waiting"}</span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">{g.summary}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <EvidenceDetails bundle={bundle} result={result} credentialRef={ref} />

      <Card as="section" className="space-y-4">
        <div className="flex items-center gap-2">
          <Icon name="share" className="size-4 text-neutral-500" />
          <h2 className="text-base font-semibold tracking-tight">Share this check</h2>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 space-y-3">
            <CopyLink url={url} />
            {holder?.handle ? (
              <p>
                <Link href={`/p/${holder.handle}`} className={btn.link}>
                  View {holder.displayName}&apos;s profile
                </Link>
              </p>
            ) : null}
          </div>
          <QrCode url={url} label="QR code for this verification link" />
        </div>
      </Card>
    </div>
  );
}
