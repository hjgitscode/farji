import type { Metadata } from "next";
import { buildIssuerTxAction, recordIssuerTxAction, sealBatchAction } from "@/app/issuer/chain-actions";
import { short } from "@/components/wallet/TxTable";
import { ActionButton, TxButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { configuredChainId, issuerCohortOverview } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Cohort batches" };

export default async function IssuerCohortPage() {
  const actor = await requireIssuer("/issuer/cohort");
  const batches = await issuerCohortOverview(getDb(), actor);
  const chainId = configuredChainId();
  const open = batches.find((b) => b.status === "OPEN");
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Cohort batches</h1>
      <p className="text-sm text-neutral-700">
        Signed permanent and expiring credentials gather in one open batch. Sealing freezes it; anchoring writes its root to the chain. A late credential always goes into a new batch.
      </p>
      {open ? <ActionButton label={`Seal the open batch (${open._count.leaves} credential${open._count.leaves === 1 ? "" : "s"})`} disabled={open._count.leaves === 0} action={sealBatchAction} /> : null}
      <ul className="space-y-3">
        {batches.map((b) => (
          <li key={b.id} className="space-y-2 rounded border border-neutral-200 p-3 text-sm">
            <p className="font-medium">
              {b.label} · {b.status} · {b._count.leaves} credential{b._count.leaves === 1 ? "" : "s"}
            </p>
            {b.batchRoot ? <p className="text-neutral-700">root {short(b.batchRoot)}</p> : null}
            {b.anchor ? <p className="text-neutral-700">anchored as epoch {b.anchor.epoch} (chain root {short(b.anchor.chainRoot)})</p> : null}
            {chainId && b.status === "SEALED" ? (
              <TxButton label="Anchor on-chain" chainId={chainId} build={buildIssuerTxAction.bind(null, "ANCHOR_COHORT", b.id).bind(null, {})} record={recordIssuerTxAction.bind(null, "ANCHOR_COHORT", b.id)} />
            ) : null}
          </li>
        ))}
        {batches.length === 0 ? <li className="text-sm text-neutral-700">No batches yet. They appear once a credential is signed.</li> : null}
      </ul>
    </section>
  );
}
