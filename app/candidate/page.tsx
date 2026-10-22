import type { Metadata } from "next";
import Link from "next/link";
import { RecordCard } from "@/components/candidate/RecordCard";
import { Alert, btn, EmptyState, Icon, Panel, Section, Stat } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { summariseStates } from "@/lib/verification/summary";
import { getOwnProfile } from "@/server/candidate/profile";
import { deriveCandidateRecords } from "@/server/verification/records";

export const metadata: Metadata = { title: "Overview" };

const VISIBILITY_NOTE = { PRIVATE: "Private", UNLISTED: "Shared by link", PUBLIC: "Public" } as const;

export default async function CandidateDashboardPage() {
  const actor = await requireCandidate("/candidate");
  const db = getDb();
  const [{ available, records }, profile] = await Promise.all([deriveCandidateRecords(db, actor), getOwnProfile(db, actor)]);
  // Every number is a count of records whose state the verification engine derived. Nothing is estimated.
  const counts = summariseStates(records.flatMap((r) => (r.result ? [r.result.state] : [])));
  const recent = records.slice(0, 4);
  const eligible = records.filter((r) => r.result?.state === "SELF_DECLARED" && !r.archivedAt).length;
  const initials = (profile?.displayName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const actionCount = (eligible > 0 ? 1 : 0) + (profile ? 0 : 1) + (counts.needsRefresh > 0 ? 1 : 0);

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-5 bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 px-5 py-6 text-white sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-lg font-semibold tracking-wide ring-1 ring-inset ring-white/20" aria-hidden="true">
              {initials || <Icon name="user" className="size-6" />}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200/80">Your professional record</p>
              <h1 className="truncate text-2xl font-semibold tracking-tight">{profile?.displayName ?? "Welcome to FARJI"}</h1>
              <p className="truncate text-sm text-emerald-50/80">
                {profile ? (profile.headline ?? "Profile") + ` · ${VISIBILITY_NOTE[profile.visibility]}` : "Build your profile, then ask the institutions behind it to confirm it."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/candidate/claims/new" className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50">
              <Icon name="plus" className="size-4" />
              Add record
            </Link>
            <Link href="/candidate/import" className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
              <Icon name="upload" className="size-4" />
              Import
            </Link>
          </div>
        </div>
      </section>

      {!available ? <Alert tone="warning">Verification status is unavailable right now, so records are listed without a status.</Alert> : null}

      {records.length === 0 ? (
        <EmptyState
          title="Build your FARJI profile"
          icon="file"
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
          <section aria-label="Verification summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Verified" value={counts.verified} tone="verified" icon="shield-check" href="/candidate/claims" />
            <Stat label="Currently confirmed" value={counts.currentlyAttested} tone="current" icon="check" href="/candidate/claims" />
            <Stat label="Pending" value={counts.pending} tone="pending" icon="clock" href="/candidate/claims" />
            <Stat label="Needs refresh" value={counts.needsRefresh} tone="attention" icon="refresh" href="/candidate/claims" />
            <Stat label="Self-declared" value={counts.selfDeclared} tone="neutral" icon="file" href="/candidate/claims" />
          </section>

          {actionCount > 0 ? (
            <Panel title="Needs your attention" description={`${actionCount} thing${actionCount === 1 ? "" : "s"} to do`}>
              <ul className="space-y-3 text-sm">
                {eligible > 0 ? (
                  <li className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5">
                      <Icon name="badge" className="size-4 text-emerald-700" />
                      {eligible} record{eligible === 1 ? " is" : "s are"} not verified yet. Choose an organisation to request verification.
                    </span>
                    <Link href="/candidate/claims" className={btn.link}>
                      Open records
                    </Link>
                  </li>
                ) : null}
                {counts.needsRefresh > 0 ? (
                  <li className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5">
                      <Icon name="refresh" className="size-4 text-amber-700" />
                      {counts.needsRefresh} current record{counts.needsRefresh === 1 ? " needs" : "s need"} re-confirming by the organisation.
                    </span>
                    <Link href="/candidate/claims" className={btn.link}>
                      Review
                    </Link>
                  </li>
                ) : null}
                {!profile ? (
                  <li className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5">
                      <Icon name="share" className="size-4 text-sky-700" />
                      Set up your public profile. Everything stays private until you decide otherwise.
                    </span>
                    <Link href="/candidate/profile" className={btn.link}>
                      Set up profile
                    </Link>
                  </li>
                ) : null}
              </ul>
            </Panel>
          ) : null}

          <Section
            title="Recent records"
            action={
              <Link href="/candidate/claims" className={`${btn.link} inline-flex items-center gap-1.5`}>
                See all records
                <Icon name="arrow-right" className="size-3.5" />
              </Link>
            }
          >
            <ul className="grid gap-3 md:grid-cols-2">
              {recent.map((r) => (
                <RecordCard key={r.claimId} record={r} available={available} />
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
