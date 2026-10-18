import type { Metadata } from "next";
import Link from "next/link";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { listIssuerRequests } from "@/server/issuer/review";

export const metadata: Metadata = { title: "Issuer dashboard" };

export default async function IssuerDashboardPage() {
  const actor = await requireIssuer("/issuer");
  const open = await listIssuerRequests(getDb(), actor, "open");
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Issuer dashboard</h1>
      <p className="text-neutral-700">
        {open.length === 0 ? "No open verification requests." : `${open.length} open verification request${open.length === 1 ? "" : "s"}.`}
      </p>
      <p>
        <Link href="/issuer/requests" className="underline">
          Review requests
        </Link>
      </p>
    </section>
  );
}
