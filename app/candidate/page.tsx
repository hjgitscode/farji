import type { Metadata } from "next";
import Link from "next/link";
import { RecordCard } from "@/components/candidate/RecordCard";
import { Alert, btn, EmptyState, PageHeader, Section, Stat } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { summariseStates } from "@/lib/verification/summary";
import { getOwnProfile } from "@/server/candidate/profile";
import { deriveCandidateRecords } from "@/server/verification/records";

export const metadata: Metadata = { title: "Dashboard" };

export default async function CandidateDashboardPage() {
  const actor = await requireCandidate("/candidate");
  const db = getDb();
  const [{ available, records }, profile] = await Promise.all([deriveCandidateRecords(db, actor), getOwnProfile(db, actor)]);
  // Every number is a count of records whose state the verification engine derived. Nothing is estimated.
  const counts = summariseStates(records.flatMap((r) => (r.result ? [r.result.state] : [])));
  const recent = records.slice(0, 4);
  const eligible = records.filter((r) => r.result?.state === "SELF_DECLARED" && !r.archivedAt).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Your professional record"
        description="Build your profile, ask the institutions you worked or studied with to confirm it, and share what is verified."
        actions={
          <>
            <Link href="/candidate/import" className={btn.primary}>
              Import professional profile
            </Link>
            <Link href="/candidate/claims/new" className={btn.secondary}>
              Add record
            </Link>
            <Link href="/candidate/profile" className={btn.secondary}>
              View profile
            </Link>
          </>
        }
      />

      {!available ? <Alert tone="warning">Verification status is unavailable right now, so records are listed without a status.</Alert> : null}

      {records.length === 0 ? (
        <EmptyState
          title="Build your FARJI profile"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/candidate/import" className={btn.primary}>
                Import professional profile
              </Link>
              <Link href="/candidate/claims/new" className={btn.secondary}>
                Add manually
              </Link>
            </div>
          }
        >
          Import from LinkedIn or another professional profile by pasting it or uploading a CSV, or add your records one by one. Nothing is verified until the institution confirms it.
        </EmptyState>
      ) : (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Verified records" value={counts.verified} tone="verified" href="/candidate/claims" />
            <Stat label="Currently confirmed" value={counts.currentlyAttested} tone="current" href="/candidate/claims" />
            <Stat label="Pending verification" value={counts.pending} tone="pending" href="/candidate/claims" />
            <Stat label="Needs refresh" value={counts.needsRefresh} tone="attention" href="/candidate/claims" />
            <Stat label="Self-declared" value={counts.selfDeclared} tone="neutral" href="/candidate/claims" />
          </section>

          {eligible > 0 ? (
            <Alert tone="info" title="Ready to be verified">
              {eligible} record{eligible === 1 ? " is" : "s are"} not verified yet. Open a record and choose an organisation to request verification.
            </Alert>
          ) : null}
          {!profile ? (
            <Alert tone="info" title="Set up your public profile">
              Choose a profile name and what to share. Everything stays private until you decide otherwise.{" "}
              <Link href="/candidate/profile" className="font-medium underline">
                Set up profile
              </Link>
            </Alert>
          ) : null}

          <Section title="Recent records">
            <ul className="grid gap-3 md:grid-cols-2">
              {recent.map((r) => (
                <RecordCard key={r.claimId} record={r} available={available} />
              ))}
            </ul>
            <p>
              <Link href="/candidate/claims" className={btn.link}>
                See all records
              </Link>
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
