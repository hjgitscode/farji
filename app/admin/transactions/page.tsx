import type { Metadata } from "next";
import { rescanFormAction, syncAllAction, syncTransactionAction } from "@/app/admin/actions";
import { TxTable } from "@/components/wallet/TxTable";
import { ActionButton } from "@/components/wallet/WalletButtons";
import { requireAdmin } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { adminListTransactions } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Blockchain transactions" };

export default async function AdminTransactionsPage() {
  const actor = await requireAdmin("/admin/transactions");
  const rows = await adminListTransactions(getDb(), actor);
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Blockchain transactions</h1>
      <p className="text-sm text-neutral-700">
        Statuses are operational. A transaction counts as evidence only once it is FINALIZED; the server, not the browser, decides that by reading the chain.
      </p>
      <ActionButton label="Check all unfinished transactions" action={syncAllAction} />
      <TxTable rows={rows} sync={syncTransactionAction} />
      <form
        action={rescanFormAction}
        className="space-y-2 rounded border border-neutral-200 p-3 text-sm"
      >
        <h2 className="font-medium">Rescan a block range</h2>
        <p className="text-neutral-700">Finds registry transactions FARJI never recorded. Only replacements of a recorded transaction are adopted.</p>
        <div className="flex gap-2">
          <input name="from" type="number" min={0} required placeholder="from block" aria-label="From block" className="w-32 rounded border border-neutral-300 px-2 py-1.5" />
          <input name="to" type="number" min={0} required placeholder="to block" aria-label="To block" className="w-32 rounded border border-neutral-300 px-2 py-1.5" />
          <button type="submit" className="rounded border border-neutral-900 px-3 py-1.5">
            Rescan
          </button>
        </div>
      </form>
    </section>
  );
}
