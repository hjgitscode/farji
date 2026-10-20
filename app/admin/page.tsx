import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { adminListOrganisations, adminListTransactions } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const actor = await requireAdmin("/admin");
  const db = getDb();
  const [orgs, txs] = await Promise.all([adminListOrganisations(db, actor), adminListTransactions(db, actor)]);
  const pending = orgs.filter((o) => o.status === "PENDING_ONBOARDING").length;
  const suspended = orgs.filter((o) => o.status === "SUSPENDED").length;
  const unfinished = txs.filter((t) => t.status === "PENDING" || t.status === "CONFIRMED").length;
  const problems = txs.filter((t) => t.status === "FAILED" || t.status === "DROPPED").length;
  return (
    <div className="space-y-8">
      <PageHeader title="Administration" description="Admins govern organisations and their issuer wallets. They never issue, end or revoke credentials." />
      <section aria-label="Overview" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Organisations" value={orgs.length} href="/admin/organisations" />
        <Stat label="Awaiting registration" value={pending} tone="pending" href="/admin/organisations" />
        <Stat label="Suspended" value={suspended} tone={suspended > 0 ? "attention" : "neutral"} href="/admin/organisations" />
        <Stat label="Transactions in progress" value={unfinished} tone={problems > 0 ? "danger" : "neutral"} href="/admin/transactions" />
      </section>
      {problems > 0 ? (
        <Card className="border-rose-300">
          <p className="font-medium text-rose-900">
            {problems} transaction{problems === 1 ? "" : "s"} failed or {problems === 1 ? "was" : "were"} replaced.
          </p>
          <Link href="/admin/transactions" className="text-sm font-medium underline">
            Review transactions
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
