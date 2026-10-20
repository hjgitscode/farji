import type { Metadata } from "next";
import { buildIssuerTxAction, recordIssuerTxAction, sealBatchAction } from "@/app/issuer/chain-actions";
import { Alert, Badge, Card, EmptyState, Facts, PageHeader } from "@/components/ui";
import { short } from "@/components/wallet/TxTable";
import { ActionButton, TxButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { formatDate } from "@/lib/format";
import { configuredChainId, issuerCohortOverview } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Credential batches" };

const STAGE = { OPEN: ["Collecting", "pending"], SEALED: ["Ready to anchor", "attention"], ANCHORED: ["Finalized", "verified"] } as const;

export default async function IssuerCohortPage() {
  const actor = await requireIssuer("/issuer/cohort");
  const batches = await issuerCohortOverview(getDb(), actor);
  const chainId = configuredChainId();
  const open = batches.find((b) => b.status === "OPEN");
  const waiting = open?._count.leaves ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader title="Credential batches" description="Signed permanent and expiring credentials wait here. Close a batch when you are ready, then anchor it so the credentials become verifiable. A credential signed later joins the next batch." />
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">
            {waiting} credential{waiting === 1 ? "" : "s"} waiting for a batch
          </p>
          <p className="text-sm text-neutral-600">Anchor within 30 days of signing so the evidence stays valid.</p>
        </div>
        {open ? <ActionButton label="Close this batch" disabled={waiting === 0} action={sealBatchAction} /> : null}
      </Card>
      {!chainId ? <Alert tone="warning">Anchoring is not available: this server is not connected to the network yet.</Alert> : null}
      {batches.length === 0 ? (
        <EmptyState title="No batches yet">They appear once a credential is signed.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {batches.map((b) => (
            <Card as="li" key={b.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {b.label} · {b._count.leaves} credential{b._count.leaves === 1 ? "" : "s"}
                </p>
                <Badge tone={STAGE[b.status][1]}>{STAGE[b.status][0]}</Badge>
              </div>
              {chainId && b.status === "SEALED" ? (
                <TxButton label="Anchor this batch" chainId={chainId} build={buildIssuerTxAction.bind(null, "ANCHOR_COHORT", b.id).bind(null, {})} record={recordIssuerTxAction.bind(null, "ANCHOR_COHORT", b.id)} />
              ) : null}
              {b.status !== "OPEN" ? (
                <details className="text-sm text-neutral-600">
                  <summary className="cursor-pointer">Technical verification details</summary>
                  <div className="mt-2">
                    <Facts
                      items={[
                        ["Closed", b.sealedAt ? formatDate(b.sealedAt) : ""],
                        ["Batch fingerprint", b.batchRoot ? short(b.batchRoot) : ""],
                        ["Anchor sequence", b.anchor ? String(b.anchor.epoch) : ""],
                        ["Anchor record", b.anchor ? short(b.anchor.chainRoot) : ""],
                      ]}
                    />
                  </div>
                </details>
              ) : null}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
