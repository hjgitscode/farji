import type { Metadata } from "next";
import Link from "next/link";
import { saveProfileAction } from "@/app/candidate/actions";
import { ProfileForm } from "@/components/candidate/ProfileForm";
import { Alert, btn, PageHeader, Section } from "@/components/ui";
import { CopyLink } from "@/components/ui/CopyLink";
import { QrCode } from "@/components/ui/QrCode";
import { requireCandidate } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { getOwnProfile, suggestHandle } from "@/server/candidate/profile";
import { profilePath, publicOrigin } from "@/server/public/origin";
import { deriveCandidateRecords } from "@/server/verification/records";

export const metadata: Metadata = { title: "Profile & sharing" };

export default async function CandidateProfilePage() {
  const actor = await requireCandidate("/candidate/profile");
  const db = getDb();
  const [profile, { records }] = await Promise.all([getOwnProfile(db, actor), deriveCandidateRecords(db, actor)]);
  const listed = records.filter((r) => r.visibility === "PUBLIC" && !r.archivedAt).length;
  const origin = await publicOrigin();
  const url = profile ? `${origin}${profilePath(profile.handle)}` : null;
  const resolves = profile && profile.visibility !== "PRIVATE";

  return (
    <div className="space-y-8">
      <PageHeader title="Profile & sharing" description="Decide what the world can see. Nothing is shared until you choose it, and a record that is not verified is always shown as self-declared." />
      <Section title="Your profile">
        <ProfileForm action={saveProfileAction} initial={profile ?? { handle: suggestHandle(""), visibility: "PRIVATE" }} />
      </Section>

      {profile && url ? (
        <Section title="Share your profile" description={resolves ? `${listed} record${listed === 1 ? " is" : "s are"} listed on your profile.` : "Your profile is private, so this link does not open for anyone else yet."}>
          {!resolves ? <Alert tone="warning">Set &ldquo;Who can open your profile page&rdquo; to share it, then save.</Alert> : null}
          <CopyLink url={url} label="Copy profile link" />
          {resolves ? (
            <>
              <QrCode url={url} label="QR code for your profile link" />
              <p>
                <Link href={profilePath(profile.handle)} className={btn.link}>
                  Open public profile
                </Link>
              </p>
            </>
          ) : null}
          {listed === 0 && resolves ? <Alert tone="info">No records are listed yet. Open a record and choose &ldquo;On my public profile&rdquo;.</Alert> : null}
        </Section>
      ) : null}
    </div>
  );
}
