import type { Metadata } from "next";
import Link from "next/link";
import { Alert, btn, Card, PageHeader, Section } from "@/components/ui";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { issuerListCredentials, issuerListTransactions, configuredChainId } from "@/server/chain/queries";
import { listIssuerRequests } from "@/server/issuer/review";

export const metadata: Metadata = { title: "Dashboard" };

export default async function IssuerDashboardPage() {
  const actor = await requireIssuer("/issuer");
  const db = getDb();
  const [open, credentials, txs] = await Promise.all([listIssuerRequests(db, actor, "open"), issuerListCredentials(db, actor), issuerListTransactions(db, actor)]);

  const toSign = credentials.filter((c) => c.pipelineStatus === "AWAITING_SIGNATURE").length;
  const queued = credentials.filter((c) => c.pipelineStatus === "SIGNED" || c.pipelineStatus === "QUEUED_FOR_ANCHOR").length;
  const anchoring = txs.filter((t) => (t.purpose === "ANCHOR_COHORT" || t.purpose === "ANCHOR_PROOF_PULSE") && (t.status === "PENDING" || t.status === "CONFIRMED")).length;
  const finalized = credentials.filter((c) => c.pipelineStatus === "ANCHORED").length;
  const failed = txs.filter((t) => t.status === "FAILED" || t.status === "DROPPED").length;

  const steps = [
    { label: "Review", count: open.length, hint: "requests waiting", href: "/issuer/requests" },
    { label: "Sign", count: toSign, hint: "approved, to sign", href: "/issuer/credentials" },
    { label: "Queue", count: queued, hint: "waiting to be anchored", href: "/issuer/cohort" },
    { label: "Anchor", count: anchoring, hint: "being recorded", href: "/issuer/transactions" },
    { label: "Finalized", count: finalized, hint: "complete", href: "/issuer/history" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Issuer dashboard" description="Confirm records from your organisation's own files. Each confirmation moves through five steps." />
      {!configuredChainId() ? <Alert tone="warning">Signing and recording are not configured on this server yet, so you can review requests but not sign.</Alert> : null}
      {failed > 0 ? (
        <Alert tone="error" title="Some activity did not complete">
          {failed} transaction{failed === 1 ? "" : "s"} failed or {failed === 1 ? "was" : "were"} replaced.{" "}
          <Link href="/issuer/transactions" className="font-medium underline">
            Review activity
          </Link>
        </Alert>
      ) : null}

      <ol className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Verification steps">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Link href={s.href} className="block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">
              <Card className="h-full">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {i + 1}. {s.label}
                </p>
                <p className="mt-1 text-3xl font-semibold">{s.count}</p>
                <p className="text-xs text-neutral-600">{s.hint}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ol>

      <Section title="Work to do">
        <div className="flex flex-wrap gap-2">
          <Link href="/issuer/requests" className={btn.primary}>
            Review requests{open.length > 0 ? ` (${open.length})` : ""}
          </Link>
          <Link href="/issuer/credentials" className={btn.secondary}>
            Sign credentials{toSign > 0 ? ` (${toSign})` : ""}
          </Link>
          <Link href="/issuer/pulse" className={btn.secondary}>
            Current relationships
          </Link>
          <Link href="/issuer/wallet" className={btn.secondary}>
            Wallet
          </Link>
        </div>
      </Section>
    </div>
  );
}
