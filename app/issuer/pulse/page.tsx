import type { Metadata } from "next";
import { acceptEndAction, buildIssuerTxAction, prepareEndAction, recordIssuerTxAction } from "@/app/issuer/chain-actions";
import { EndRelationshipButton } from "@/components/wallet/ParamForms";
import { short } from "@/components/wallet/TxTable";
import { TxButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { readContent } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { configuredChainId, issuerPulseOverview } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Current relationships" };

export default async function IssuerPulsePage() {
  const actor = await requireIssuer("/issuer/pulse");
  const { tree, anchors } = await issuerPulseOverview(getDb(), actor);
  const chainId = configuredChainId();
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Current relationships</h1>
      <p className="text-sm text-neutral-700">
        Ongoing employment, enrolment and membership. Anchoring an epoch snapshots the current state; nothing is rebuilt. Ending a relationship is not a revocation.
      </p>
      {!tree ? <p className="text-sm text-neutral-700">No current relationships yet. They appear once an ongoing credential is signed.</p> : null}
      {tree ? (
        <>
          <p className="text-sm text-neutral-700">
            State #{tree.currentRootSeq} · {tree.nextLeafIndex} record{tree.nextLeafIndex === 1 ? "" : "s"} · root {short(tree.currentRoot)}
            {anchors[0] ? ` · latest epoch ${anchors[0].epoch} covers state #${anchors[0].rootSeq}` : " · not anchored yet"}
          </p>
          {chainId && tree.currentRootSeq >= 1 ? (
            <TxButton label="Anchor current state as a new epoch" chainId={chainId} build={buildIssuerTxAction.bind(null, "ANCHOR_PROOF_PULSE", tree.id).bind(null, {})} record={recordIssuerTxAction.bind(null, "ANCHOR_PROOF_PULSE", tree.id)} />
          ) : null}
          <ul className="space-y-3">
            {tree.leaves.map((l) => {
              const c = readContent(l.credential.claimVersion.content);
              return (
                <li key={l.credential.id} className="space-y-2 rounded border border-neutral-200 p-3 text-sm">
                  <p className="font-medium">
                    #{l.leafIndex} {c.title} · {c.organisationName}
                  </p>
                  <p className="text-neutral-700">
                    {l.scope.toLowerCase()} · {l.status} · {l.credential.pipelineStatus}
                  </p>
                  {chainId && l.status === "ACTIVE" ? (
                    <EndRelationshipButton chainId={chainId} prepare={prepareEndAction.bind(null, l.credential.id)} accept={acceptEndAction.bind(null, l.credential.id)} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
