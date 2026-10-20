import type { Metadata } from "next";
import { acceptEndAction, buildIssuerTxAction, prepareEndAction, recordIssuerTxAction } from "@/app/issuer/chain-actions";
import { Alert, Badge, Card, EmptyState, Facts, PageHeader } from "@/components/ui";
import { EndRelationshipButton } from "@/components/wallet/ParamForms";
import { short } from "@/components/wallet/TxTable";
import { TxButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { readContent } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { CATEGORY_LABEL } from "@/lib/format";
import { configuredChainId, issuerPulseOverview } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Current relationships" };

const SCOPE_CATEGORY = { EMPLOYMENT: "EXPERIENCE", ENROLMENT: "EDUCATION", MEMBERSHIP: "MEMBERSHIP" } as const;

export default async function IssuerPulsePage() {
  const actor = await requireIssuer("/issuer/pulse");
  const { tree, anchors } = await issuerPulseOverview(getDb(), actor);
  const chainId = configuredChainId();
  const active = tree?.leaves.filter((l) => l.status === "ACTIVE").length ?? 0;
  const ended = tree?.leaves.filter((l) => l.status === "ENDED").length ?? 0;
  const covered = anchors[0] && tree ? anchors[0].rootSeq === tree.currentRootSeq : false;
  return (
    <div className="space-y-6">
      <PageHeader title="Current relationships" description="Ongoing employment, enrolment and membership. Re-confirming keeps them shown as current. Time passing alone changes nothing here, and ending a relationship is not a revocation." />
      {!tree ? (
        <EmptyState title="No current relationships yet">They appear once an ongoing credential is signed.</EmptyState>
      ) : (
        <>
          <Card className="space-y-3">
            <p className="font-semibold">
              {active} active · {ended} ended
            </p>
            <p className="text-sm text-neutral-600">
              {covered ? "Your latest confirmation covers the current state." : anchors[0] ? "There are changes since your last confirmation. Confirm again so they count as current." : "Nothing has been confirmed yet. Confirm so these relationships can show as current."}
            </p>
            {chainId && tree.currentRootSeq >= 1 ? (
              <TxButton label="Confirm current relationships" chainId={chainId} build={buildIssuerTxAction.bind(null, "ANCHOR_PROOF_PULSE", tree.id).bind(null, {})} record={recordIssuerTxAction.bind(null, "ANCHOR_PROOF_PULSE", tree.id)} />
            ) : null}
            {!chainId ? <Alert tone="warning">Confirming is not available: this server is not connected to the network yet.</Alert> : null}
            <details className="text-sm text-neutral-600">
              <summary className="cursor-pointer">Technical verification details</summary>
              <div className="mt-2">
                <Facts items={[["State number", String(tree.currentRootSeq)], ["Current fingerprint", short(tree.currentRoot)], ["Latest confirmation covers state", anchors[0] ? `#${anchors[0].rootSeq} (sequence ${anchors[0].epoch})` : "none yet"]]} />
              </div>
            </details>
          </Card>
          <ul className="space-y-3">
            {tree.leaves.map((l) => {
              const c = readContent(l.credential.claimVersion.content);
              return (
                <Card as="li" key={l.credential.id} className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{c.title}</p>
                      <p className="text-sm text-neutral-700">
                        {c.organisationName} · {CATEGORY_LABEL[SCOPE_CATEGORY[l.scope]]}
                      </p>
                    </div>
                    <Badge tone={l.status === "ACTIVE" ? "current" : "muted"}>{l.status === "ACTIVE" ? "Active" : "Ended"}</Badge>
                  </div>
                  {chainId && l.status === "ACTIVE" ? (
                    <div className="space-y-1">
                      <p className="text-sm text-neutral-600">Choose the day the relationship ended. This records that it ended; it does not revoke or delete anything.</p>
                      <EndRelationshipButton chainId={chainId} prepare={prepareEndAction.bind(null, l.credential.id)} accept={acceptEndAction.bind(null, l.credential.id)} />
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
