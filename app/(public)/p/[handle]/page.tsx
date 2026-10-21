import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicRecordCard } from "@/components/public/PublicRecordCard";
import { Alert, Card, EmptyState } from "@/components/ui";
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

  return (
    <div className="space-y-8">
      <Card className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{profile.displayName}</h1>
        {profile.headline ? <p className="text-neutral-800">{profile.headline}</p> : null}
        {profile.location ? <p className="text-sm text-neutral-600">{profile.location}</p> : null}
        {profile.about ? <p className="max-w-2xl whitespace-pre-line text-sm text-neutral-700">{profile.about}</p> : null}
      </Card>

      {!profile.available ? <Alert tone="warning">Verification status is unavailable right now, so records are not listed.</Alert> : null}

      {profile.available && profile.records.length === 0 ? <EmptyState title="No records shared yet">This person has not published any records.</EmptyState> : null}

      {verified.length > 0 ? (
        <section className="space-y-3" aria-labelledby="verified-h">
          <h2 id="verified-h" className="text-lg font-semibold">
            Verified by organisations
          </h2>
          <p className="text-sm text-neutral-600">The organisation named on each record confirmed it from its own records.</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {verified.map((r) => (
              <PublicRecordCard key={r.index} record={r} />
            ))}
          </ul>
        </section>
      ) : null}

      {attention.length > 0 ? (
        <section className="space-y-3" aria-labelledby="attention-h">
          <h2 id="attention-h" className="text-lg font-semibold">
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
          <h2 id="declared-h" className="text-lg font-semibold">
            Self-declared
          </h2>
          <p className="text-sm text-neutral-600">Added by {profile.displayName}. No organisation has verified these records.</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {declared.map((r) => (
              <PublicRecordCard key={r.index} record={r} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3" aria-label="Share this profile">
        <h2 className="text-lg font-semibold">Share this profile</h2>
        <CopyLink url={url} label="Copy profile link" />
        <QrCode url={url} label={`QR code for ${profile.displayName}'s profile`} />
      </section>
    </div>
  );
}
