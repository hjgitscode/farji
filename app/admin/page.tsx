import type { Metadata } from "next";
import Link from "next/link";
import { Alert, btn, EmptyState, Icon, Panel, RowList, Stat, StatusPill } from "@/components/ui";
import { PURPOSE } from "@/components/wallet/TxTable";
import { requireAdmin } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { formatDateTime } from "@/lib/format";
import { ORG_STATUS, TX_STATUS } from "@/lib/ui/status";
import { adminListOrganisations, adminListTransactions } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminDashboardPage() {
  const actor = await requireAdmin("/admin");
  const db = getDb();
  const [orgs, txs] = await Promise.all([adminListOrganisations(db, actor), adminListTransactions(db, actor)]);
  const active = orgs.filter((o) => o.status === "ACTIVE").length;
  const pending = orgs.filter((o) => o.status === "PENDING_ONBOARDING");
  const suspended = orgs.filter((o) => o.status === "SUSPENDED").length;
  const pendingTx = txs.filter((t) => t.status === "PENDING").length;
  const confirmedTx = txs.filter((t) => t.status === "CONFIRMED").length;
  const finalizedTx = txs.filter((t) => t.status === "FINALIZED").length;
  const problems = txs.filter((t) => t.status === "FAILED" || t.status === "DROPPED").length;
  const total = txs.length;
  const recent = txs.slice(0, 5);
  const segments = [
    { label: "Finalized", n: finalizedTx, cls: "bg-emerald-500" },
    { label: "Confirmed, not final", n: confirmedTx, cls: "bg-amber-400" },
    { label: "Pending", n: pendingTx, cls: "bg-indigo-400" },
    { label: "Failed or replaced", n: problems, cls: "bg-rose-500" },
  ];

  return (
    <div>
      <div className="mb-7 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Control centre</p>
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">Administration</h1>
        <p className="max-w-2xl text-sm text-neutral-600">Admins govern organisations and their issuer wallets. They never issue, end or revoke credentials.</p>
      </div>

      <div className="space-y-6">
        {problems > 0 ? (
          <Alert tone="error" title="Some transactions did not complete">
            {problems} transaction{problems === 1 ? "" : "s"} failed or {problems === 1 ? "was" : "were"} replaced.{" "}
            <Link href="/admin/transactions" className="font-medium underline">
              Review transactions
            </Link>
          </Alert>
        ) : null}

        <section aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Organisations" value={orgs.length} icon="building" hint={`${active} active`} href="/admin/organisations" />
          <Stat label="Awaiting registration" value={pending.length} tone={pending.length > 0 ? "pending" : "neutral"} icon="clock" hint="not yet on the network" href="/admin/organisations" />
          <Stat label="Suspended" value={suspended} tone={suspended > 0 ? "attention" : "neutral"} icon="alert" hint="cannot confirm records" href="/admin/organisations" />
          <Stat label="Transactions in progress" value={pendingTx + confirmedTx} tone={problems > 0 ? "danger" : pendingTx + confirmedTx > 0 ? "attention" : "neutral"} icon="activity" hint="waiting to be final" href="/admin/transactions" />
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Finality health" description="Only a final transaction counts as evidence." action={<Link href="/admin/transactions" className={btn.link}>All transactions</Link>}>
            {total === 0 ? (
              <EmptyState title="No transactions yet" icon="activity">
                Registering an organisation or authorising a wallet appears here as it is sent from your wallet.
              </EmptyState>
            ) : (
              <div className="space-y-4">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={`${finalizedTx} of ${total} transactions finalized`}>
                  {segments
                    .filter((s) => s.n > 0)
                    .map((s) => (
                      <span key={s.label} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
                    ))}
                </div>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {segments.map((s) => (
                    <li key={s.label} className="flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${s.cls}`} aria-hidden="true" />
                      <span className="text-neutral-600">{s.label}</span>
                      <span className="ml-auto font-semibold tabular-nums">{s.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel title="Needs registration" description="Register on the network to activate.">
            {pending.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-neutral-600">
                <Icon name="check" className="size-4 text-emerald-600" strokeWidth={2.5} />
                Every organisation is registered.
              </p>
            ) : (
              <ul className="-my-1 divide-y divide-neutral-100">
                {pending.slice(0, 5).map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{o.displayName}</p>
                      <p className="text-xs text-neutral-500">{ORG_STATUS[o.status]?.label}</p>
                    </div>
                    <Link href={`/admin/organisations/${o.id}`} className={btn.link}>
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <section className="space-y-3" aria-label="Recent transactions">
          <h2 className="text-base font-semibold tracking-tight">Recent activity</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-neutral-600">Nothing yet.</p>
          ) : (
            <RowList>
              {recent.map((t) => {
                const s = TX_STATUS[t.status] ?? { tone: "neutral" as const, label: t.status, note: "", icon: "circle" as const };
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{PURPOSE[t.purpose] ?? t.purpose.toLowerCase().replaceAll("_", " ")}</p>
                      <p className="text-xs text-neutral-500">
                        {t.organisation?.displayName ? `${t.organisation.displayName} · ` : ""}
                        {formatDateTime(t.submittedAt)}
                      </p>
                    </div>
                    <StatusPill display={s} />
                  </li>
                );
              })}
            </RowList>
          )}
        </section>
      </div>
    </div>
  );
}
