import type { Metadata } from "next";
import { createClaimAction } from "@/app/candidate/actions";
import { ClaimForm } from "@/components/candidate/ClaimForm";
import { requireCandidate } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Add a record" };

export default async function NewClaimPage() {
  await requireCandidate("/candidate/claims/new");
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Add a record</h1>
      <ClaimForm action={createClaimAction} submitLabel="Save record" />
    </section>
  );
}
