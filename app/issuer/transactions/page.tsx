import type { Metadata } from "next";
import { syncIssuerTxAction } from "@/app/issuer/chain-actions";
import { TxTable } from "@/components/wallet/TxTable";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { issuerListTransactions } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Transactions" };

export default async function IssuerTransactionsPage() {
  const actor = await requireIssuer("/issuer/transactions");
  const rows = await issuerListTransactions(getDb(), actor);
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Transactions</h1>
      <p className="text-sm text-neutral-700">
        A transaction is tracked until it is final. Only a FINALIZED transaction changes anything in FARJI: until then credentials stay queued and nothing is shown as anchored or revoked.
      </p>
      <TxTable rows={rows} sync={syncIssuerTxAction} />
    </section>
  );
}
