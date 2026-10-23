import type { Metadata } from "next";
import { buildIssuerTxAction, recordIssuerTxAction, sealBatchAction } from "@/app/issuer/chain-actions";
import { Alert, Badge, Card, Disclosure, EmptyState, Facts, Icon, Mono, PageHeader, Stepper, type StepState } from "@/components/ui";
import { BatchLeaves, CohortExplainer } from "@/components/issuer/ProofExplainers";
import { short } from "@/components/wallet/TxTable";
import { ActionButton, TxButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { formatDate, formatDateTime } from "@/lib/format";
import { BATCH_STATUS } from "@/lib/ui/status";
import { configuredChainId, issuerCohortOverview, issuerListTransactions } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Credential batches" };

const LABELS = ["Collecting", "Closed", "Anchored", "Final"];

/** Batch lifecycle as the issuer sees it: collecting, closed (ready to anchor), then anchored and final. */
const stepsFor = (status: "OPEN" | "SEALED" | "ANCHORED"): { label: string; state: StepState }[] => {
  const at = status === "OPEN" ? 0 : status === "SEALED" ? 1 : 4;
  return LABELS.map((label, i) => ({ label, state: i < at ? "done" : i === at ? "current" : "todo" }));
};

export default async function IssuerCohortPage() {
  const actor = await requireIssuer("/issuer/cohort");
  const [batches, txs] = await Promise.all([issuerCohortOverview(getDb(), actor), issuerListTransactions(getDb(), actor)]);
  // The newest anchor transaction per batch decides what the batch shows; a valid one blocks a second submission.
  const anchorTx = new Map<string, { status: string }>();
  for (const t of [...txs].reverse()) if (t.purpose === "ANCHOR_COHORT" && t.targetType === "COHORT_BATCH") anchorTx.set(t.targetId, t);
  const chainId = configuredChainId();
  const open = batches.find((b) => b.status === "OPEN");
  const waiting = open?._count.leaves ?? 0;
  const ready = batches.filter((b) => b.status === "SEALED" && anchorTx.get(b.id)?.status !== "PENDING" && anchorTx.get(b.id)?.status !== "CONFIRMED");
  return (
    <div>
      <PageHeader
        title="Credential batches"
        description="Close the open batch, then anchor it so its credentials become verifiable."
      />
      <div className="space-y-5">
        <CohortExplainer />
        {!chainId ? <Alert tone="warning">Anchoring is not available: this server is not connected to the network yet.</Alert> : null}

        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex size-12 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <Icon name="layers" className="size-6" />
            </span>
            <div>
              <p className="text-lg font-semibold leading-tight">
                {waiting} credential{waiting === 1 ? "" : "s"} <span className="font-normal text-neutral-500">waiting for a batch</span>
              </p>
              <p className="text-sm text-neutral-600">Anchor within 30 days of signing so the evidence stays valid.</p>
            </div>
          </div>
          {open ? <ActionButton label="Close this batch" icon="lock" variant={ready.length === 0 ? "primary" : "secondary"} disabled={waiting === 0} action={sealBatchAction} /> : null}
        </Card>

        {batches.length === 0 ? (
          <EmptyState title="No batches yet" icon="layers">
            A batch is created automatically when you sign your first permanent or expiring credential.
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {batches.map((b) => {
              const base = BATCH_STATUS[b.status];
              const tx = anchorTx.get(b.id);
              const inFlight = b.status === "SEALED" && (tx?.status === "PENDING" || tx?.status === "CONFIRMED");
              const failed = b.status === "SEALED" && (tx?.status === "FAILED" || tx?.status === "DROPPED");
              const s = inFlight
                ? { tone: "pending" as const, label: tx?.status === "CONFIRMED" ? "Waiting for finality" : "Anchor transaction submitted" }
                : failed
                  ? { tone: "danger" as const, label: "Anchor failed — retry" }
                  : base;
              return (
                <Card as="li" key={b.id} className={`space-y-4 ${b.status === "SEALED" ? "border-amber-300 bg-gradient-to-br from-white to-amber-50/40" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{b.label}</p>
                      <p className="text-sm text-neutral-600">
                        {b._count.leaves} credential{b._count.leaves === 1 ? "" : "s"}
                        {b.sealedAt ? ` · closed ${formatDate(b.sealedAt)}` : ""}
                        {b.batchRoot ? <> · fingerprint <Mono>{short(b.batchRoot)}</Mono></> : null}
                      </p>
                    </div>
                    <Badge tone={s.tone} icon={b.status === "ANCHORED" ? "check" : inFlight ? "clock" : failed ? "x" : b.status === "SEALED" ? "anchor" : "clock"}>
                      {s.label}
                    </Badge>
                  </div>

                  <BatchLeaves count={b._count.leaves} root={b.batchRoot} />
                  <Stepper label="Batch progress" steps={stepsFor(b.status)} />

                  {chainId && b.status === "SEALED" && !inFlight ? (
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
                      <p className="max-w-md text-sm text-neutral-800">
                        <span className="font-medium">This batch is closed and ready.</span> Anchoring records it on the network. You will confirm one transaction in your wallet; the batch counts as evidence once it is final.
                      </p>
                      <TxButton label="Anchor this batch" icon="anchor" chainId={chainId} build={buildIssuerTxAction.bind(null, "ANCHOR_COHORT", b.id).bind(null, {})} record={recordIssuerTxAction.bind(null, "ANCHOR_COHORT", b.id)} />
                    </div>
                  ) : null}
                  {b.status === "ANCHORED" ? <p className="text-sm text-emerald-800">Anchored and final. These credentials can be verified publicly.</p> : null}

                  {b.status !== "OPEN" ? (
                    <Disclosure tone="plain" summary="Technical verification details">
                      <Facts
                        items={[
                          ["Closed", b.sealedAt ? formatDateTime(b.sealedAt) : ""],
                          ["Batch fingerprint", b.batchRoot ? <Mono key="r">{b.batchRoot}</Mono> : ""],
                          ["Anchor sequence", b.anchor ? String(b.anchor.epoch) : ""],
                          ["Anchor record", b.anchor ? <Mono key="a">{b.anchor.chainRoot}</Mono> : ""],
                        ]}
                      />
                    </Disclosure>
                  ) : null}
                </Card>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
