import type { Metadata } from "next";
import { acceptSigningAction, buildIssuerTxAction, enqueuePendingAction, prepareSigningAction, recordIssuerTxAction } from "@/app/issuer/chain-actions";
import { ParamTxButton } from "@/components/wallet/ParamForms";
import { ActionButton, SignButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { readContent } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { configuredChainId, issuerListCredentials } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Credentials" };

const PIPELINE_NOTE: Record<string, string> = {
  AWAITING_SIGNATURE: "approved, waiting for your signature",
  SIGNED: "signed",
  QUEUED_FOR_ANCHOR: "queued for anchoring (not yet final on-chain)",
  ANCHORED: "anchored on-chain and final",
};

const REASONS = [
  { value: "ISSUED_IN_ERROR", label: "Issued in error" },
  { value: "FRAUD", label: "Fraud" },
  { value: "RECORD_CORRECTED", label: "Record corrected" },
  { value: "OTHER", label: "Other" },
];

export default async function IssuerCredentialsPage() {
  const actor = await requireIssuer("/issuer/credentials");
  const credentials = await issuerListCredentials(getDb(), actor);
  const chainId = configuredChainId();
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Credentials</h1>
      <p className="text-sm text-neutral-700">
        Pipeline statuses show progress only; they are not verification results. ENDED and EXPIRED are not revocations.
      </p>
      <ActionButton label="Queue signed credentials that are waiting" action={enqueuePendingAction} />
      {!chainId ? <p className="text-sm text-red-700">Blockchain features are not configured on this server.</p> : null}
      <ul className="space-y-3">
        {credentials.map((c) => {
          const content = readContent(c.claimVersion.content);
          return (
            <li key={c.id} className="space-y-2 rounded border border-neutral-200 p-3 text-sm">
              <p className="font-medium">
                {content.title} · {content.organisationName}
              </p>
              <p className="text-neutral-700">
                {c.claimVersion.claim.category.toLowerCase()} · {c.lifecycleType.toLowerCase()} · version {c.claimVersion.versionNumber} · {c.pipelineStatus} ({PIPELINE_NOTE[c.pipelineStatus]})
                {c.revocation ? ` · REVOKED (${c.revocation.reasonCode.toLowerCase().replaceAll("_", " ")})` : ""}
              </p>
              {chainId && c.pipelineStatus === "AWAITING_SIGNATURE" ? (
                <SignButton label="Sign with wallet" chainId={chainId} prepare={prepareSigningAction.bind(null, c.id)} accept={acceptSigningAction.bind(null, c.id)} />
              ) : null}
              {chainId && c.pipelineStatus !== "AWAITING_SIGNATURE" && !c.revocation ? (
                <ParamTxButton
                  label="Revoke"
                  chainId={chainId}
                  paramName="reason"
                  kind="choice"
                  options={REASONS}
                  build={buildIssuerTxAction.bind(null, "REVOKE_CREDENTIAL", c.id)}
                  record={recordIssuerTxAction.bind(null, "REVOKE_CREDENTIAL", c.id)}
                />
              ) : null}
            </li>
          );
        })}
        {credentials.length === 0 ? <li className="text-sm text-neutral-700">No credentials yet. Approve a verification request first.</li> : null}
      </ul>
    </section>
  );
}
