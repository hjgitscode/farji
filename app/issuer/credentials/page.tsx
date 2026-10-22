import type { Metadata } from "next";
import Link from "next/link";
import { acceptSigningAction, buildIssuerTxAction, enqueuePendingAction, prepareSigningAction, recordIssuerTxAction } from "@/app/issuer/chain-actions";
import { Alert, Badge, btn, Card, categoryIcon, Disclosure, EmptyState, Facts, Icon, Mono, PageHeader, StatusPill, Stepper, type StepState } from "@/components/ui";
import { ParamTxButton } from "@/components/wallet/ParamForms";
import { ActionButton, SignButton } from "@/components/wallet/WalletButtons";
import { requireIssuer } from "@/lib/auth/guards";
import { readContent } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { CATEGORY_LABEL, formatDate, LIFECYCLE_LABEL } from "@/lib/format";
import { PIPELINE_STATUS } from "@/lib/ui/status";
import { configuredChainInfo, issuerListCredentials } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Credentials" };

// Plain-language progress. These are workflow steps, NOT verification results: the public state is derived separately.
const STEP_INDEX: Record<string, number> = { AWAITING_SIGNATURE: 0, SIGNED: 1, QUEUED_FOR_ANCHOR: 2, ANCHORED: 3 };
const STEP_LABELS = ["Sign", "Batch", "Anchor", "Final"];

const steps = (status: string): { label: string; state: StepState }[] => {
  const at = STEP_INDEX[status] ?? 0;
  return STEP_LABELS.map((label, i) => ({ label, state: status === "ANCHORED" || i < at ? "done" : i === at ? "current" : "todo" }));
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
    <div>
      <PageHeader
        title="Credentials"
        description="Sign approved records and follow each one to completion. Withdraw a credential only in exceptional cases."
        actions={<ActionButton label="Queue signed credentials" icon="layers" action={enqueuePendingAction} />}
      />
      <div className="space-y-4">
        {!chainId ? <Alert tone="warning">Signing is not available: this server is not connected to the network yet.</Alert> : null}
        {credentials.length === 0 ? (
          <EmptyState title="No credentials yet" icon="pen">
            Approved verification requests appear here to be signed. Approve a request first.
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {credentials.map((c) => {
              const content = readContent(c.claimVersion.content);
              const display = PIPELINE_STATUS[c.pipelineStatus];
              return (
                <Card as="li" key={c.id} className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3.5">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                        <Icon name={categoryIcon(c.claimVersion.claim.category)} className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold leading-snug">{content.title}</p>
                        <p className="text-sm text-neutral-700">
                          {content.organisationName} · {CATEGORY_LABEL[c.claimVersion.claim.category] ?? c.claimVersion.claim.category} · {LIFECYCLE_LABEL[c.lifecycleType] ?? ""} · version {c.claimVersion.versionNumber}
                        </p>
                      </div>
                    </div>
                    {c.revocation ? <Badge tone="danger" icon="x">Revoked {formatDate(c.revocation.revokedAt)}</Badge> : display ? <StatusPill display={display} /> : null}
                  </div>

                  {!c.revocation ? <Stepper label="Progress" steps={steps(c.pipelineStatus)} /> : null}
                  <p className="text-sm text-neutral-600">{c.revocation ? `Revoked: ${c.revocation.reasonCode.toLowerCase().replaceAll("_", " ")}.` : display?.note}</p>

                  {chainId && c.pipelineStatus === "AWAITING_SIGNATURE" ? (
                    <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                      <p className="text-sm text-neutral-800">You are confirming that this record matches your organisation&apos;s records. Your wallet will show the readable record to sign. Signing is free and sends nothing to the network.</p>
                      <SignButton label="Sign credential" icon="pen" chainId={chainId} prepare={prepareSigningAction.bind(null, c.id)} accept={acceptSigningAction.bind(null, c.id)} />
                    </div>
                  ) : null}

                  {c.pipelineStatus === "SIGNED" || c.pipelineStatus === "QUEUED_FOR_ANCHOR" ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                      <p className="text-sm text-neutral-700">
                        <span className="font-medium text-neutral-900">Next:</span> close the open batch, then anchor it. Both buttons are on the Batches page.
                      </p>
                      <Link href="/issuer/cohort" className={btn.primary}>
                        <Icon name="layers" className="size-4" />
                        Go to Batches
                      </Link>
                    </div>
                  ) : null}

                  {chainId && c.pipelineStatus === "AWAITING_SIGNATURE" ? (
                    <Disclosure tone="plain" summary="View signing details">
                      <Facts
                        items={[
                          ["Network", `Chain ${chain?.chainId}`],
                          ["Registry contract", chain ? <Mono key="r">{chain.registry}</Mono> : ""],
                          ["Credential identifier", c.credentialId ? <Mono key="c">{c.credentialId}</Mono> : "Created when you start signing"],
                          ["Signed by", "The wallet you connect, which must be authorised for your organisation"],
                        ]}
                      />
                    </Disclosure>
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
    </div>
  );
}
