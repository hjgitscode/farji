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
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">Issuer dashboard</h1>
      <p className="text-neutral-700">
        {open.length === 0 ? "No open verification requests." : `${open.length} open verification request${open.length === 1 ? "" : "s"}.`}
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <Link href="/issuer/requests" className="underline">
            Review requests
          </Link>
        </li>
        <li>
          <Link href="/issuer/credentials" className="underline">
            Credentials: sign and revoke
          </Link>
        </li>
        <li>
          <Link href="/issuer/cohort" className="underline">
            Cohort batches
          </Link>
        </li>
        <li>
          <Link href="/issuer/pulse" className="underline">
            Current relationships
          </Link>
        </li>
        <li>
          <Link href="/issuer/transactions" className="underline">
            Transactions
          </Link>
        </li>
        <li>
          <Link href="/issuer/wallet" className="underline">
            Issuer wallet
          </Link>
        </li>
      </ul>
    </section>
  );
}
