import type { Metadata } from "next";
import Link from "next/link";
import { RecordCard } from "@/components/candidate/RecordCard";
import { Alert, btn, EmptyState, PageHeader, TabNav } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/guards";
import { CATEGORY_PLURAL } from "@/lib/format";
import { getDb } from "@/lib/database/client";
import { deriveCandidateRecords } from "@/server/verification/records";

export const metadata: Metadata = { title: "My records" };

const TABS = [
  { key: "ALL", label: "All records", href: "/candidate/claims" },
  { key: "EXPERIENCE", label: "Experience", href: "/candidate/claims?category=EXPERIENCE" },
  { key: "EDUCATION", label: "Education", href: "/candidate/claims?category=EDUCATION" },
  { key: "CERTIFICATION", label: "Certifications", href: "/candidate/claims?category=CERTIFICATION" },
  { key: "MEMBERSHIP", label: "Memberships", href: "/candidate/claims?category=MEMBERSHIP" },
];

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const actor = await requireCandidate("/candidate/claims");
  const filter = TABS.some((t) => t.key === category) ? (category as string) : "ALL";
  // Derived from evidence on every request; nothing about verification is stored.
  const { available, records } = await deriveCandidateRecords(getDb(), actor);
  const shown = records.filter((r) => !r.archivedAt && (filter === "ALL" || r.category === filter));

  return (
    <div>
      <PageHeader
        title={filter === "ALL" ? "My records" : CATEGORY_PLURAL[filter]}
        description="Each record shows where it stands today. Only an organisation's confirmation makes a record verified."
        actions={
          <>
            <Link href="/candidate/import" className={btn.secondary}>
              Import
            </Link>
            <Link href="/candidate/claims/new" className={btn.primary}>
              Add record
            </Link>
          </>
        }
      />
      <TabNav items={TABS} current={filter} />
      {!available ? <Alert tone="warning">Verification status is unavailable right now.</Alert> : null}
      {shown.length === 0 ? (
        <EmptyState title="Nothing here yet" action={<Link href="/candidate/claims/new" className={btn.primary}>Add a record</Link>}>
          {filter === "ALL" ? "You have not added any records yet." : "You have no records in this section yet."}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((r) => (
            <RecordCard key={r.claimId} record={r} available={available} />
          ))}
        </ul>
      )}
    </div>
  );
}
