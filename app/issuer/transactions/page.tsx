import type { Metadata } from "next";
import { syncIssuerTxAction } from "@/app/issuer/chain-actions";
import { PageHeader } from "@/components/ui";
import { TxTable } from "@/components/wallet/TxTable";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { issuerListTransactions } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Activity" };

export default async function IssuerTransactionsPage() {
  const actor = await requireIssuer("/issuer/transactions");
  const rows = await issuerListTransactions(getDb(), actor);
  return (
    <div>
      <PageHeader title="Activity" description="Each signing, anchoring or revocation is tracked until it is final. Only a final transaction counts: until then nothing is shown as verified or revoked." />
      <TxTable rows={rows} sync={syncIssuerTxAction} />
    </div>
  );
}
