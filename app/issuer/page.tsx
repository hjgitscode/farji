import type { Metadata } from "next";
import Link from "next/link";
import { Alert, btn, EmptyState, Icon, Panel, Stat, type IconName } from "@/components/ui";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { configuredChainId, issuerCohortOverview, issuerListCredentials, issuerListTransactions } from "@/server/chain/queries";
import { listIssuerRequests } from "@/server/issuer/review";

export const metadata: Metadata = { title: "Overview" };

type Task = { icon: IconName; title: string; detail: string; href: string; cta: string; primary?: boolean };

export default async function IssuerDashboardPage() {
  const actor = await requireIssuer("/issuer");
  const db = getDb();
  const [open, credentials, txs, batches] = await Promise.all([
    listIssuerRequests(db, actor, "open"),
    issuerListCredentials(db, actor),
    issuerListTransactions(db, actor),
    issuerCohortOverview(db, actor),
  ]);

  const toSign = credentials.filter((c) => c.pipelineStatus === "AWAITING_SIGNATURE").length;
  const queued = credentials.filter((c) => c.pipelineStatus === "SIGNED" || c.pipelineStatus === "QUEUED_FOR_ANCHOR").length;
  const openBatch = batches.find((b) => b.status === "OPEN");
  const waitingInBatch = openBatch?._count.leaves ?? 0;
  const readyToAnchor = batches.filter((b) => b.status === "SEALED").length;
  const anchoring = txs.filter((t) => (t.purpose === "ANCHOR_COHORT" || t.purpose === "ANCHOR_PROOF_PULSE") && (t.status === "PENDING" || t.status === "CONFIRMED")).length;
  const finalized = credentials.filter((c) => c.pipelineStatus === "ANCHORED").length;
  const failed = txs.filter((t) => t.status === "FAILED" || t.status === "DROPPED").length;

  // The work queue: only what actually needs doing, most urgent first.
  const tasks: Task[] = [];
  if (open.length > 0) tasks.push({ icon: "inbox", title: `${open.length} request${open.length === 1 ? "" : "s"} to review`, detail: "Check each against your own records, then approve or reject.", href: "/issuer/requests", cta: "Review requests", primary: true });
  if (toSign > 0) tasks.push({ icon: "pen", title: `${toSign} credential${toSign === 1 ? "" : "s"} awaiting your signature`, detail: "Approved records are signed with your organisation's wallet.", href: "/issuer/credentials", cta: "Sign credentials", primary: tasks.length === 0 });
  if (waitingInBatch > 0 && readyToAnchor === 0) tasks.push({ icon: "layers", title: `${waitingInBatch} signed credential${waitingInBatch === 1 ? "" : "s"} waiting in the open batch`, detail: "Close the batch when you are ready to anchor it.", href: "/issuer/cohort", cta: "Go to batches", primary: tasks.length === 0 });
  if (readyToAnchor > 0) tasks.push({ icon: "anchor", title: `${readyToAnchor} batch${readyToAnchor === 1 ? "" : "es"} ready to anchor`, detail: "Anchoring records the batch on the network. You confirm one wallet transaction.", href: "/issuer/cohort", cta: "Anchor batch", primary: tasks.length === 0 });
  if (anchoring > 0) tasks.push({ icon: "clock", title: `${anchoring} transaction${anchoring === 1 ? "" : "s"} being recorded`, detail: "These count as evidence only once final.", href: "/issuer/transactions", cta: "Check activity" });

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">Verification operations</h1>
          <p className="max-w-2xl text-sm text-neutral-600">Review, sign, batch and anchor your organisation&apos;s confirmations.</p>
        </div>
        <Link href="/issuer/requests" className={btn.primary}>
          <Icon name="inbox" className="size-4" />
          Review requests{open.length > 0 ? ` (${open.length})` : ""}
        </Link>
      </div>

      <div className="space-y-6">
        {!configuredChainId() ? <Alert tone="warning">Signing and recording are not configured on this server yet, so you can review requests but not sign.</Alert> : null}
        {failed > 0 ? (
          <Alert tone="error" title="Some activity did not complete">
            {failed} transaction{failed === 1 ? "" : "s"} failed or {failed === 1 ? "was" : "were"} replaced.{" "}
            <Link href="/issuer/transactions" className="font-medium underline">
              Review activity
            </Link>
          </Alert>
        ) : null}

        <section aria-label="Verification pipeline" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="To review" value={open.length} tone={open.length > 0 ? "pending" : "neutral"} icon="inbox" hint="requests waiting" href="/issuer/requests" />
          <Stat label="To sign" value={toSign} tone={toSign > 0 ? "attention" : "neutral"} icon="pen" hint="approved records" href="/issuer/credentials" />
          <Stat label="In batches" value={queued} tone="pending" icon="layers" hint="signed, not yet anchored" href="/issuer/cohort" />
          <Stat label="Ready to anchor" value={readyToAnchor} tone={readyToAnchor > 0 ? "attention" : "neutral"} icon="anchor" hint={anchoring > 0 ? `${anchoring} being recorded` : "closed batches"} href="/issuer/cohort" />
          <Stat label="Finalized" value={finalized} tone="verified" icon="shield-check" hint="anchored and final" href="/issuer/history" />
        </section>

        <Panel title="Up next" description={tasks.length > 0 ? "What needs doing, most urgent first." : undefined}>
          {tasks.length === 0 ? (
            <EmptyState title="You are all caught up" icon="check">
              New verification requests from candidates will appear here. Signed credentials and batches show up as they need your attention.
            </EmptyState>
          ) : (
            <ul className="-my-1 divide-y divide-neutral-100">
              {tasks.map((t) => (
                <li key={t.title} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                      <Icon name={t.icon} className="size-[1.1rem]" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-900">{t.title}</p>
                      <p className="text-sm text-neutral-600">{t.detail}</p>
                    </div>
                  </div>
                  <Link href={t.href} className={t.primary ? btn.primary : btn.secondary}>
                    {t.cta}
                    <Icon name="arrow-right" className="size-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { href: "/issuer/pulse", icon: "users" as IconName, title: "Current relationships", text: "Re-confirm ongoing roles and end finished ones." },
            { href: "/issuer/wallet", icon: "wallet" as IconName, title: "Signing wallet", text: "Your organisation's authority to sign and anchor." },
            { href: "/issuer/history", icon: "history" as IconName, title: "Verification history", text: "Where each issued credential stands today." },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="group flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-card transition hover:-translate-y-px hover:border-neutral-300 hover:shadow-lift">
              <Icon name={l.icon} className="mt-0.5 size-5 text-emerald-700" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                  {l.title}
                  <Icon name="arrow-right" className="size-3.5 text-neutral-400 transition group-hover:translate-x-0.5" />
                </span>
                <span className="text-sm text-neutral-600">{l.text}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
