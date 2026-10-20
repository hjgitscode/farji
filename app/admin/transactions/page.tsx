import type { Metadata } from "next";
import { rescanFormAction, syncAllAction, syncTransactionAction } from "@/app/admin/actions";
import { btn, Card, inputClass, PageHeader, Section } from "@/components/ui";
import { TxTable } from "@/components/wallet/TxTable";
import { ActionButton } from "@/components/wallet/WalletButtons";
import { requireAdmin } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { adminListTransactions } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Transactions" };

export default async function AdminTransactionsPage() {
  const actor = await requireAdmin("/admin/transactions");
  const rows = await adminListTransactions(getDb(), actor);
  return (
    <div className="space-y-8">
      <PageHeader
        title="Transactions"
        description="Everything sent from a wallet is tracked until it is final. The server decides what counts by reading the network itself, never the browser."
        actions={<ActionButton label="Check all unfinished" action={syncAllAction} />}
      />
      <TxTable rows={rows} sync={syncTransactionAction} />
      <Section title="Look for missed transactions" description="Finds registry transactions FARJI never recorded. Only replacements of a recorded transaction are adopted; everything else is only noted.">
        <Card>
          <form action={rescanFormAction} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label htmlFor="from" className="block text-xs font-medium text-neutral-700">
                From block
              </label>
              <input id="from" name="from" type="number" min={0} required className={`${inputClass} w-36`} />
            </div>
            <div className="space-y-1">
              <label htmlFor="to" className="block text-xs font-medium text-neutral-700">
                To block
              </label>
              <input id="to" name="to" type="number" min={0} required className={`${inputClass} w-36`} />
            </div>
            <button type="submit" className={btn.secondary}>
              Scan
            </button>
          </form>
        </Card>
      </Section>
    </div>
  );
}
