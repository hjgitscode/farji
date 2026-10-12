import type { Metadata } from "next";
import Link from "next/link";
import { requireCandidate } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Candidate dashboard" };

export default async function CandidateDashboardPage() {
  await requireCandidate("/candidate");
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">Candidate dashboard</h1>
      <p className="text-neutral-700">Manage your professional records and verification requests.</p>
      <p>
        <Link href="/candidate/claims" className="underline">
          My records
        </Link>
      </p>
    </section>
  );
}
