import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicRecordCard } from "@/components/public/PublicRecordCard";
import { Alert, Card, EmptyState, Icon } from "@/components/ui";
import { CopyLink } from "@/components/ui/CopyLink";
import { QrCode } from "@/components/ui/QrCode";
import { getDb } from "@/lib/database/client";
import { TooManyRequests } from "@/components/public/Notices";
import { RULES } from "@/lib/security/rate-limit";
import { getPublicProfile } from "@/server/public/read";
import { checkLimit, requestKey } from "@/server/security/limit";
import { profilePath, publicOrigin } from "@/server/public/origin";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const profile = await getPublicProfile(getDb(), handle);
  if (!profile) return { title: "Profile unavailable", robots: { index: false } };
  return {
    title: profile.displayName,
    description: profile.headline ?? `${profile.displayName} on FARJI`,
    // An unlisted profile opens by link but must not be indexed.
    robots: profile.indexable ? undefined : { index: false, follow: false },
  };
}

export default async function PublicProfilePage({ params }: Props) {
  const { handle } = await params;
  if (!checkLimit(RULES.publicRead, await requestKey()).allowed) return <TooManyRequests />;
  const profile = await getPublicProfile(getDb(), handle);
  // A private or unknown profile is the same page: nothing reveals which.
  if (!profile) notFound();
  const verified = profile.records.filter((r) => r.group === "VERIFIED");
  const attention = profile.records.filter((r) => r.group === "ATTENTION");
  const declared = profile.records.filter((r) => r.group === "SELF_DECLARED");
  const url = `${await publicOrigin()}${profilePath(profile.handle)}`;

  const initials = profile.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card">
        <div className="h-24 bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-700 sm:h-28" aria-hidden="true" />
        <div className="px-5 pb-6 sm:px-8">
          <div className="-mt-10 flex flex-wrap items-end justify-between gap-4">
            <span className="flex size-20 items-center justify-center rounded-xl border-4 border-white bg-neutral-900 text-2xl font-semibold tracking-wide text-white shadow-card" aria-hidden="true">
              {initials || "?"}
            </span>
            {profile.available && verified.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                <Icon name="shield-check" className="size-4" />
                {verified.length} verified record{verified.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <div className="mt-4 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{profile.displayName}</h1>
            {profile.headline ? <p className="text-neutral-800">{profile.headline}</p> : null}
            {profile.location ? (
              <p className="flex items-center gap-1.5 text-sm text-neutral-500">
                <Icon name="globe" className="size-4" />
                {profile.location}
              </p>
            ) : null}
            {profile.about ? <p className="max-w-2xl whitespace-pre-line pt-1 text-sm leading-relaxed text-neutral-700">{profile.about}</p> : null}
          </div>
        </div>
      </section>

      {!profile.available ? <Alert tone="warning">Verification status is unavailable right now, so records are not listed.</Alert> : null}

      {profile.available && profile.records.length === 0 ? <EmptyState title="No records shared yet" icon="file">This person has not published any records.</EmptyState> : null}

      {verified.length > 0 ? (
        <section className="space-y-3" aria-labelledby="verified-h">
          <div>
            <h2 id="verified-h" className="text-base font-semibold tracking-tight">
              Verified by organisations
            </h2>
            <p className="text-sm text-neutral-600">The organisation named on each record confirmed it from its own records.</p>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {verified.map((r) => (
              <PublicRecordCard key={r.index} record={r} />
            ))}
          </ul>
        </section>
      ) : null}

      {attention.length > 0 ? (
        <section className="space-y-3" aria-labelledby="attention-h">
          <h2 id="attention-h" className="text-base font-semibold tracking-tight">
            Records with a status to be aware of
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {attention.map((r) => (
              <PublicRecordCard key={r.index} record={r} />
            ))}
          </ul>
        </section>
      ) : null}

      {declared.length > 0 ? (
        <section className="space-y-3" aria-labelledby="declared-h">
          <div>
            <h2 id="declared-h" className="text-base font-semibold tracking-tight">
              Self-declared
            </h2>
            <p className="text-sm text-neutral-600">Added by {profile.displayName}. No organisation has verified these records.</p>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {declared.map((r) => (
              <PublicRecordCard key={r.index} record={r} />
            ))}
          </ul>
        </section>
      ) : null}

      <Card as="section" className="space-y-4">
        <div className="flex items-center gap-2">
          <Icon name="share" className="size-4 text-neutral-500" />
          <h2 className="text-base font-semibold tracking-tight">Share this profile</h2>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <CopyLink url={url} label="Copy profile link" />
          </div>
          <QrCode url={url} label={`QR code for ${profile.displayName}'s profile`} />
        </div>
      </Card>
    </div>
  );
}
