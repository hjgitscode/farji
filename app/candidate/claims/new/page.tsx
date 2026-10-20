import type { Metadata } from "next";
import { createClaimAction } from "@/app/candidate/actions";
import { ClaimForm } from "@/components/candidate/ClaimForm";
import { PageHeader } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Add a record" };

export default async function NewClaimPage() {
  await requireCandidate("/candidate/claims/new");
  return (
    <div>
      <PageHeader title="Add a record" description="It starts as self-declared and private. You can ask an organisation to verify it afterwards." />
      <ClaimForm action={createClaimAction} submitLabel="Save record" />
    </div>
  );
}
