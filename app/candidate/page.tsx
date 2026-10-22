import type { Metadata } from "next";
import Link from "next/link";
import { RecordRow } from "@/components/candidate/RecordRow";
import { Alert, btn, EmptyState, Icon } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { CATEGORY_PLURAL } from "@/lib/format";
import { summariseStates } from "@/lib/verification/summary";
import { getOwnProfile } from "@/server/candidate/profile";
import { profilePath } from "@/server/public/origin";
import { deriveCandidateRecords } from "@/server/verification/records";

export const metadata: Metadata = { title: "Profile" };

const SECTIONS = ["EXPERIENCE", "EDUCATION", "CERTIFICATION", "MEMBERSHIP"] as const;
const VISIBILITY_NOTE = { PRIVATE: "Private", UNLISTED: "Shared by link", PUBLIC: "Public" } as const;

export default async function CandidateProfilePage() {
  const actor = await requireCandidate("/candidate");
  const db = getDb();
  const [{ available, records }, profile] = await Promise.all([deriveCandidateRecords(db, actor), getOwnProfile(db, actor)]);
  // Every number is a count of records whose state the verification engine derived. Nothing is estimated.
  const counts = summariseStates(records.flatMap((r) => (r.result ? [r.result.state] : [])));
  const live = records.filter((r) => !r.archivedAt);
  const unverified = live.filter((r) => r.result?.state === "SELF_DECLARED").length;
  const initials = (profile?.displayName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
      <div className="min-w-0 space-y-4">
        <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
          <div className="h-24 bg-neutral-800" aria-hidden="true" />
          <div className="px-5 pb-5 sm:px-6">
            <div className="-mt-10 flex items-end justify-between gap-3">
              <span className="flex size-20 items-center justify-center rounded-full border-4 border-white bg-emerald-800 text-2xl font-semibold text-white" aria-hidden="true">
                {initials || <Icon name="user" className="size-8" />}
              </span>
              <div className="flex gap-2">
                <Link href="/candidate/profile" className={btn.secondary}>
                  Edit profile
                </Link>
                {profile && profile.visibility !== "PRIVATE" ? (
                  <Link href={profilePath(profile.handle)} className={btn.secondary}>
                    View public profile
                  </Link>
                ) : null}
              </div>
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">{profile?.displayName ?? "Your profile"}</h1>
            <p className="text-neutral-800">{profile?.headline ?? "Add a headline so people know who you are."}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-neutral-500">
              {profile?.location ? <span>{profile.location}</span> : null}
              <span className="inline-flex items-center gap-1.5">
                <Icon name={profile?.visibility === "PUBLIC" ? "globe" : profile?.visibility === "UNLISTED" ? "link" : "lock"} className="size-3.5" />
                {profile ? VISIBILITY_NOTE[profile.visibility] : "Private"}
              </span>
            </p>
          </div>
        </section>

        {profile?.about ? (
          <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-card sm:px-6">
            <h2 className="text-base font-semibold">About</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-neutral-700">{profile.about}</p>
          </section>
        ) : null}

        {!available ? <Alert tone="warning">Verification status is unavailable right now, so records are listed without a status.</Alert> : null}

        {live.length === 0 ? (
          <EmptyState
            title="Add your first record"
            icon="file"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/candidate/claims/new" className={btn.primary}>
                  Add record
                </Link>
                <Link href="/candidate/import" className={btn.secondary}>
                  Import
                </Link>
              </div>
            }
          >
            Experience, education and certifications start as self-declared until the organisation confirms them.
          </EmptyState>
        ) : (
          SECTIONS.map((cat) => {
            const rows = live.filter((r) => r.category === cat);
            if (rows.length === 0) return null;
            return (
              <section key={cat} className="rounded-lg border border-neutral-200 bg-white p-5 shadow-card sm:px-6" aria-labelledby={`h-${cat}`}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 id={`h-${cat}`} className="text-base font-semibold">
                    {CATEGORY_PLURAL[cat]}
                  </h2>
                  <Link href={`/candidate/claims/new`} className="text-sm font-medium text-emerald-800 hover:underline">
                    Add
                  </Link>
                </div>
                <ul className="divide-y divide-neutral-100">
                  {rows.map((r) => (
                    <RecordRow key={r.claimId} record={r} available={available} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <aside className="space-y-4">
        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-card" aria-label="Verification summary">
          <h2 className="text-sm font-semibold">Verification</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ["Verified", counts.verified, "text-emerald-700"],
              ["Currently confirmed", counts.currentlyAttested, "text-teal-700"],
              ["Pending", counts.pending, "text-indigo-700"],
              ["Needs refresh", counts.needsRefresh, "text-amber-700"],
              ["Self-declared", counts.selfDeclared, "text-neutral-500"],
            ].map(([label, n, cls]) => (
              <div key={label as string} className="flex items-center justify-between">
                <dt className="text-neutral-600">{label}</dt>
                <dd className={`font-semibold tabular-nums ${cls}`}>{n}</dd>
              </div>
            ))}
          </dl>
        </section>

        {unverified > 0 || !profile ? (
          <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-card" aria-label="Next steps">
            <h2 className="text-sm font-semibold">Next steps</h2>
            <ul className="mt-3 space-y-3 text-sm text-neutral-700">
              {unverified > 0 ? (
                <li>
                  {unverified} record{unverified === 1 ? " is" : "s are"} not verified.{" "}
                  <Link href="/candidate/claims" className={btn.link}>
                    Request verification
                  </Link>
                </li>
              ) : null}
              {!profile ? (
                <li>
                  Set up your public profile.{" "}
                  <Link href="/candidate/profile" className={btn.link}>
                    Set up
                  </Link>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-col gap-2">
          <Link href="/candidate/claims/new" className={btn.primary}>
            <Icon name="plus" className="size-4" />
            Add record
          </Link>
          <Link href="/candidate/import" className={btn.secondary}>
            <Icon name="upload" className="size-4" />
            Import profile
          </Link>
        </div>
      </aside>
    </div>
  );
}
