import type { Metadata } from "next";
import { acceptSigningAction, buildIssuerTxAction, enqueuePendingAction, prepareSigningAction, recordIssuerTxAction } from "@/app/issuer/chain-actions";
import { Alert, Badge, Card, EmptyState, Facts, PageHeader } from "@/components/ui";
import { ParamTxButton } from "@/components/wallet/ParamForms";
import { ActionButton, SignButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { readContent } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { CATEGORY_LABEL, formatDate, LIFECYCLE_LABEL } from "@/lib/format";
import { configuredChainInfo, issuerListCredentials } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Credentials" };

// Plain-language progress. These are workflow steps, NOT verification results: the public state is derived separately.
const STAGE: Record<string, { step: string; note: string }> = {
  AWAITING_SIGNATURE: { step: "Sign", note: "Approved. Waiting for you to sign." },
  SIGNED: { step: "Queue", note: "Signed. Waiting to join a batch." },
  QUEUED_FOR_ANCHOR: { step: "Anchor", note: "Signed and queued. Not final until it is anchored and confirmed." },
  ANCHORED: { step: "Finalized", note: "Anchored and final." },
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
  const chain = configuredChainInfo();
  const chainId = chain?.chainId ?? null;
  return (
    <div className="space-y-6">
      <PageHeader title="Credentials" description="Sign approved records, follow them to completion, and withdraw a credential only in exceptional cases." actions={<ActionButton label="Queue signed credentials" action={enqueuePendingAction} />} />
      {!chainId ? <Alert tone="warning">Signing is not available: this server is not connected to the network yet.</Alert> : null}
      {credentials.length === 0 ? (
        <EmptyState title="No credentials yet">Approve a verification request first. Approved records appear here to be signed.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {credentials.map((c) => {
            const content = readContent(c.claimVersion.content);
            const stage = STAGE[c.pipelineStatus];
            return (
              <Card as="li" key={c.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{content.title}</p>
                    <p className="text-sm text-neutral-700">
                      {content.organisationName} · {CATEGORY_LABEL[c.claimVersion.claim.category] ?? c.claimVersion.claim.category} · {LIFECYCLE_LABEL[c.lifecycleType] ?? ""} · version {c.claimVersion.versionNumber}
                    </p>
                  </div>
                  {c.revocation ? <Badge tone="danger">Revoked {formatDate(c.revocation.revokedAt)}</Badge> : <Badge tone={c.pipelineStatus === "ANCHORED" ? "verified" : "pending"}>{stage?.step}</Badge>}
                </div>
                <p className="text-sm text-neutral-600">{c.revocation ? `Revoked: ${c.revocation.reasonCode.toLowerCase().replaceAll("_", " ")}.` : stage?.note}</p>

                {chainId && c.pipelineStatus === "AWAITING_SIGNATURE" ? (
                  <div className="space-y-2">
                    <p className="text-sm text-neutral-700">You are confirming that this record matches your organisation&apos;s records.</p>
                    <SignButton label="Sign credential" chainId={chainId} prepare={prepareSigningAction.bind(null, c.id)} accept={acceptSigningAction.bind(null, c.id)} />
                    <details className="text-sm text-neutral-600">
                      <summary className="cursor-pointer">View signing details</summary>
                      <div className="mt-2">
                        <Facts
                          items={[
                            ["Network", chain ? `Chain ${chain.chainId}` : ""],
                            ["Registry contract", chain ? <code key="r" className="break-all text-xs">{chain.registry}</code> : ""],
                            ["Credential identifier", c.credentialId ? <code key="c" className="break-all text-xs">{c.credentialId}</code> : "Created when you start signing"],
                            ["Signed by", "The wallet you connect, which must be authorised for your organisation"],
                          ]}
                        />
                      </div>
                    </details>
                  </div>
                ) : null}

                {chainId && c.pipelineStatus !== "AWAITING_SIGNATURE" && !c.revocation ? (
                  <details className="rounded-lg border border-rose-200 bg-rose-50/40 p-3 text-sm">
                    <summary className="cursor-pointer font-medium text-rose-900">Revoke this credential…</summary>
                    <div className="mt-3 space-y-3">
                      <p className="text-neutral-800">Revocation indicates that the credential itself should no longer be relied upon. Ending a current role is not revocation.</p>
                      <ParamTxButton
                        label="Revoke credential"
                        chainId={chainId}
                        paramName="reason"
                        kind="choice"
                        options={REASONS}
                        confirm={{ title: "Revoke this credential?", body: "This permanently withdraws the credential and cannot be undone. Anyone checking it will see it as revoked. A mistaken revocation can only be remedied by issuing a new credential.", danger: true }}
                        build={buildIssuerTxAction.bind(null, "REVOKE_CREDENTIAL", c.id)}
                        record={recordIssuerTxAction.bind(null, "REVOKE_CREDENTIAL", c.id)}
                      />
                    </div>
                  </details>
                ) : null}
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
